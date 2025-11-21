/**
 * App.js - Editor Liquify Odontológico com IA (Versão Corrigida)
 * 
 * Arquivo único e auto-contido
 * Carrega ONNX Runtime via CDN (sem npm install)
 * 100% Offline após primeiro carregamento
 * 
 * Alterações:
 * 1. Estilos CSS ajustados para correta exibição do canvas.
 * 2. Lógica de renderização (applyDisplacement) corrigida para evitar "buracos brancos".
 * 3. Proteção de IA na ferramenta de pincel foi removida conforme solicitado.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============================================================================
// MÓDULO IA LITE (INTEGRADO)
// ============================================================================

const AIModuleLite = (() => {
  let ort = null;
  let segmentationSession = null;
  let isModelLoaded = false;

  const CONFIG = {
    MODEL_PATH: './models/u2netp.onnx',
    INPUT_SIZE: 320,
    WARP: {
      MASK_PROTECTION_THRESHOLD: 0.45,
      MAX_DISPLACEMENT: 3.0,
      EXTREME_DISPLACEMENT_FACTOR: 0.3,
      TEXTURE_PRESERVATION_FACTOR: 0.85
    }
  };

  // Carrega ONNX Runtime via CDN
  async function loadONNXRuntime() {
    if (ort) return ort;
    
    return new Promise((resolve, reject) => {
      if (window.ort) {
        ort = window.ort;
        resolve(ort);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort.min.js';
      script.async = true;
      
      script.onload = ( ) => {
        ort = window.ort;
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/';
        resolve(ort );
      };
      
      script.onerror = () => reject(new Error('Falha ao carregar ONNX Runtime'));
      document.head.appendChild(script);
    });
  }

  // Converte ImageData para tensor NCHW
  function imageDataToTensor(imageData) {
    const { data, width, height } = imageData;
    const tensor = new Float32Array(3 * height * width);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        const r = data[srcIdx] / 255.0;
        const g = data[srcIdx + 1] / 255.0;
        const b = data[srcIdx + 2] / 255.0;

        tensor[0 * height * width + y * width + x] = (r - mean[0]) / std[0];
        tensor[1 * height * width + y * width + x] = (g - mean[1]) / std[1];
        tensor[2 * height * width + y * width + x] = (b - mean[2]) / std[2];
      }
    }
    return tensor;
  }

  // Normaliza saída do modelo para máscara 0-1
  function outputToMask(output, width, height) {
    const mask = new Float32Array(width * height);
    let minVal = Infinity, maxVal = -Infinity;

    for (let i = 0; i < output.length; i++) {
      if (output[i] < minVal) minVal = output[i];
      if (output[i] > maxVal) maxVal = output[i];
    }

    const range = maxVal - minVal || 1;
    for (let i = 0; i < output.length; i++) {
      mask[i] = (output[i] - minVal) / range;
    }
    return mask;
  }

  // Redimensiona máscara com interpolação bilinear
  function resizeMask(mask, srcW, srcH, dstW, dstH) {
    const result = new Float32Array(dstW * dstH);
    const xRatio = srcW / dstW;
    const yRatio = srcH / dstH;

    for (let y = 0; y < dstH; y++) {
      for (let x = 0; x < dstW; x++) {
        const srcX = x * xRatio;
        const srcY = y * yRatio;
        const x1 = Math.floor(srcX);
        const y1 = Math.floor(srcY);
        const x2 = Math.min(x1 + 1, srcW - 1);
        const y2 = Math.min(y1 + 1, srcH - 1);
        const fx = srcX - x1;
        const fy = srcY - y1;

        const v00 = mask[y1 * srcW + x1];
        const v10 = mask[y1 * srcW + x2];
        const v01 = mask[y2 * srcW + x1];
        const v11 = mask[y2 * srcW + x2];

        result[y * dstW + x] = v00*(1-fx)*(1-fy) + v10*fx*(1-fy) + v01*(1-fx)*fy + v11*fx*fy;
      }
    }
    return result;
  }

  // Blur gaussiano para suavizar bordas
  function gaussianBlur(mask, width, height, radius = 2) {
    const result = new Float32Array(mask.length);
    const kernel = [];
    let sum = 0;

    for (let i = -radius; i <= radius; i++) {
      const val = Math.exp(-(i * i) / (2 * radius * radius));
      kernel.push(val);
      sum += val;
    }
    kernel.forEach((_, i) => kernel[i] /= sum);

    const temp = new Float32Array(mask.length);

    // Horizontal
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const nx = Math.max(0, Math.min(width - 1, x + k));
          s += mask[y * width + nx] * kernel[k + radius];
        }
        temp[y * width + x] = s;
      }
    }

    // Vertical
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) {
          const ny = Math.max(0, Math.min(height - 1, y + k));
          s += temp[ny * width + x] * kernel[k + radius];
        }
        result[y * width + x] = s;
      }
    }
    return result;
  }

  return {
    async loadSegmentation(modelPath = CONFIG.MODEL_PATH) {
      if (isModelLoaded) return true;
      try {
        await loadONNXRuntime();
        segmentationSession = await ort.InferenceSession.create(modelPath, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        isModelLoaded = true;
        return true;
      } catch (error) {
        console.error('[AI] Erro:', error);
        throw error;
      }
    },

    async getTeethMask(canvas) {
      if (!isModelLoaded) throw new Error('Modelo não carregado');
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const size = CONFIG.INPUT_SIZE;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = tempCanvas.height = size;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0, size, size);

      const imageData = tempCtx.getImageData(0, 0, size, size);
      const tensorData = imageDataToTensor(imageData);

      const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, size, size]);
      const inputName = segmentationSession.inputNames[0];
      
      const results = await segmentationSession.run({ [inputName]: inputTensor });
      
      const outputData = results[segmentationSession.outputNames[0]].data;
      let mask = outputToMask(outputData, size, size);
      mask = gaussianBlur(mask, size, size, 2);
      const fullMask = resizeMask(mask, size, size, w, h);

      return { mask: fullMask, width: w, height: h };
    },

    isReady: () => isModelLoaded
  };
})();

// ============================================================================
// COMPONENTE PRINCIPAL - EDITOR LIQUIFY
// ============================================================================

function App() {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [image, setImage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [modelStatus, setModelStatus] = useState('não carregado');
  const [brushSize, setBrushSize] = useState(30);
  const [brushStrength, setBrushStrength] = useState(0.5);
  const [tool, setTool] = useState('push'); // push, pinch, bloat
  const [maskVisible, setMaskVisible] = useState(false);

  const imageDataRef = useRef(null);
  const displacementMapRef = useRef(null);
  const maskDataRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  // Carrega modelo ao iniciar
  useEffect(() => {
    const loadModel = async () => {
      setModelStatus('carregando...');
      try {
        await AIModuleLite.loadSegmentation('./models/u2netp.onnx');
        setModelStatus('pronto ✓');
      } catch (e) {
        setModelStatus('erro - modelo não encontrado');
        console.warn('Modelo não encontrado. Editor funcionará sem proteção IA.');
      }
    };
    loadModel();
  }, []);

  // Carrega imagem
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        initCanvas(img);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Inicializa canvas com imagem
  const initCanvas = (img) => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const maxSize = 600;
    
    let w = img.width, h = img.height;
    if (w > maxSize || h > maxSize) {
      const ratio = Math.min(maxSize / w, maxSize / h);
      w = Math.floor(w * ratio);
      h = Math.floor(h * ratio);
    }

    canvas.width = overlay.width = w;
    canvas.height = overlay.height = h;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    imageDataRef.current = ctx.getImageData(0, 0, w, h);
    displacementMapRef.current = new Float32Array(w * h * 2);
    maskDataRef.current = null;
  };

  // Gera máscara IA
  const generateMask = async () => {
    if (!canvasRef.current || !AIModuleLite.isReady()) return;

    setIsLoading(true);
    try {
      const result = await AIModuleLite.getTeethMask(canvasRef.current);
      maskDataRef.current = result.mask;
      if (maskVisible) drawMaskOverlay();
      console.log('[Editor] Máscara gerada!');
    } catch (e) {
      console.error('Erro ao gerar máscara:', e);
    }
    setIsLoading(false);
  };

  // Desenha overlay da máscara
  const drawMaskOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!maskVisible || !maskDataRef.current) return;

    const mask = maskDataRef.current;
    const imgData = ctx.createImageData(overlay.width, overlay.height);

    for (let i = 0; i < mask.length; i++) {
      const val = Math.floor(mask[i] * 255);
      imgData.data[i * 4] = 0;
      imgData.data[i * 4 + 1] = val;
      imgData.data[i * 4 + 2] = 255 - val;
      imgData.data[i * 4 + 3] = 100;
    }

    ctx.putImageData(imgData, 0, 0);
  }, [maskVisible]);

  useEffect(() => {
    drawMaskOverlay();
  }, [maskVisible, drawMaskOverlay]);

  // >>> INÍCIO DA SEÇÃO ALTERADA <<<
  // Aplica deslocamento liquify (LÓGICA CORRIGIDA)
  const applyDisplacement = useCallback((centerX, centerY) => {
    if (!imageDataRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const displacement = displacementMapRef.current;
    
    const dx = centerX - lastPosRef.current.x;
    const dy = centerY - lastPosRef.current.y;
    const radius = brushSize;
    const strength = brushStrength;

    // 1. Atualiza o mapa de deslocamento (sem a lógica de proteção)
    for (let py = Math.max(0, centerY - radius); py < Math.min(h, centerY + radius); py++) {
      for (let px = Math.max(0, centerX - radius); px < Math.min(w, centerX + radius); px++) {
        const dist = Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2);
        if (dist >= radius) continue;

        const falloff = Math.cos((dist / radius) * Math.PI * 0.5) ** 2;
        const idx = (py * w + px) * 2;

        // A LÓGICA DE PROTEÇÃO FOI REMOVIDA DAQUI
        const factor = falloff * strength;

        if (tool === 'push') {
          displacement[idx] += dx * factor;
          displacement[idx + 1] += dy * factor;
        } else if (tool === 'pinch') {
          displacement[idx] += (centerX - px) * factor * 0.1;
          displacement[idx + 1] += (centerY - py) * factor * 0.1;
        } else if (tool === 'bloat') {
          displacement[idx] -= (centerX - px) * factor * 0.1;
          displacement[idx + 1] -= (centerY - py) * factor * 0.1;
        }
      }
    }

    // 2. Renderiza a imagem com o deslocamento (LÓGICA CORRIGIDA)
    const src = imageDataRef.current.data;
    const dst = ctx.createImageData(w, h);
    const dstData = dst.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 2;
        const srcX = Math.round(x - displacement[idx]);
        const srcY = Math.round(y - displacement[idx + 1]);

        const dstIdx = (y * w + x) * 4;

        if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
          // Se a coordenada de origem é válida, copia o pixel de lá
          const srcIdx = (srcY * w + srcX) * 4;
          dstData[dstIdx] = src[srcIdx];
          dstData[dstIdx + 1] = src[srcIdx + 1];
          dstData[dstIdx + 2] = src[srcIdx + 2];
          dstData[dstIdx + 3] = src[srcIdx + 3];
        } else {
          // CORREÇÃO: Se a coordenada for inválida (fora da imagem),
          // copia o pixel da imagem ORIGINAL, não deixando um buraco branco.
          const originalPixelIndex = (y * w + x) * 4;
          dstData[dstIdx] = src[originalPixelIndex];
          dstData[dstIdx + 1] = src[originalPixelIndex + 1];
          dstData[dstIdx + 2] = src[originalPixelIndex + 2];
          dstData[dstIdx + 3] = src[originalPixelIndex + 3];
        }
      }
    }

    ctx.putImageData(dst, 0, 0);
  }, [brushSize, brushStrength, tool]);
  // >>> FIM DA SEÇÃO ALTERADA <<<

  // Eventos do mouse
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY)
    };
  };

  const handleMouseDown = (e) => {
    if (!image) return;
    isDrawingRef.current = true;
    const pos = getPos(e);
    lastPosRef.current = pos;
  };

  const handleMouseMove = (e) => {
    if (!isDrawingRef.current) return;
    const pos = getPos(e);
    applyDisplacement(pos.x, pos.y);
    lastPosRef.current = pos;
  };

  const handleMouseUp = () => {
    isDrawingRef.current = false;
  };

  // Reset
  const handleReset = () => {
    if (!imageDataRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageDataRef.current, 0, 0);
    displacementMapRef.current = new Float32Array(canvas.width * canvas.height * 2);
  };

  // Download
  const handleDownload = () => {
    const link = document.createElement('a');
    link.download = 'editado.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>🦷 Editor Liquify Odontológico</h1>
      
      <div style={styles.statusBar}>
        <span>Modelo IA: <strong>{modelStatus}</strong></span>
        {isLoading && <span style={styles.loading}>Processando...</span>}
      </div>

      <div style={styles.toolbar}>
        <input type="file" accept="image/*" onChange={handleImageUpload} />
        
        <button onClick={generateMask} disabled={!image || !AIModuleLite.isReady()}>
          🎯 Gerar Máscara IA
        </button>
        
        <label>
          <input 
            type="checkbox" 
            checked={maskVisible} 
            onChange={(e) => setMaskVisible(e.target.checked)} 
          />
          Ver Máscara
        </label>
      </div>

      <div style={styles.tools}>
        <span>Ferramenta:</span>
        {['push', 'pinch', 'bloat'].map(t => (
          <button 
            key={t}
            onClick={() => setTool(t)}
            style={tool === t ? styles.activeTool : styles.toolBtn}
          >
            {t === 'push' ? '👆 Empurrar' : t === 'pinch' ? '🤏 Contrair' : '💨 Expandir'}
          </button>
        ))}
      </div>

      <div style={styles.sliders}>
        <label>
          Tamanho: {brushSize}px
          <input type="range" min="10" max="100" value={brushSize} 
            onChange={(e) => setBrushSize(Number(e.target.value))} />
        </label>
        <label>
          Força: {(brushStrength * 100).toFixed(0)}%
          <input type="range" min="0.1" max="1" step="0.1" value={brushStrength}
            onChange={(e) => setBrushStrength(Number(e.target.value))} />
        </label>
      </div>

      <div style={styles.canvasContainer}>
        <canvas
          ref={canvasRef}
          style={styles.canvas}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        <canvas ref={overlayRef} style={styles.overlay} />
        
        {!image && (
          <div style={styles.placeholder}>
            <span>📷 Carregue uma imagem para começar</span>
          </div>
        )}
      </div>

      <div style={styles.actions}>
        <button onClick={handleReset} disabled={!image}>↩️ Resetar</button>
        <button onClick={handleDownload} disabled={!image}>💾 Baixar</button>
      </div>
    </div>
  );
}

// ============================================================================
// ESTILOS (VERSÃO CORRIGIDA)
// ============================================================================

const styles = {
  container: {
    maxWidth: 800,
    margin: '0 auto',
    padding: 20,
    fontFamily: 'system-ui, sans-serif',
    background: '#1a1a2e',
    minHeight: '100vh',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  title: {
    textAlign: 'center',
    marginBottom: 20
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '10px 15px',
    background: '#16213e',
    borderRadius: 8,
    marginBottom: 15,
    width: '100%'
  },
  loading: {
    color: '#00d4ff',
    animation: 'pulse 1s infinite'
  },
  toolbar: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 15,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%'
  },
  tools: {
    display: 'flex',
    gap: 10,
    marginBottom: 15,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%'
  },
  toolBtn: {
    padding: '8px 12px',
    background: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer'
  },
  activeTool: {
    padding: '8px 12px',
    background: '#e94560',
    border: '1px solid #e94560',
    borderRadius: 6,
    // color: '#fff',
    cursor: 'pointer'
  },
  sliders: {
    display: 'flex',
    gap: 30,
    marginBottom: 15,
    width: '100%',
    justifyContent: 'center'
  },
  canvasContainer: {
    position: 'relative',
    background: '#0f0f23',
    borderRadius: 10,
    overflow: 'hidden',
    lineHeight: 0,
    border: '1px solid #0f3460',
    minHeight: '200px', // Altura mínima para o placeholder
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  canvas: {
    display: 'block',
    cursor: 'crosshair',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    pointerEvents: 'none'
  },
  placeholder: {
    color: '#666',
    fontSize: 18,
    padding: 50,
    textAlign: 'center'
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 15,
    justifyContent: 'center',
    width: '100%'
  }
};

export default App;
