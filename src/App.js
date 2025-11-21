import React, { useRef, useState, useEffect } from "react";
import "./assets/LiquifyEditor.css";

const LiquifyEditor = () => {
  const canvasRef = useRef(null);
  const originalRef = useRef(null);
  const displacementRef = useRef([]);
  const isDrawingRef = useRef(false);
  const lastMouseRef = useRef({ x: null, y: null });

  const [image, setImage] = useState(null);
  const [brushSize, setBrushSize] = useState(50);
  const [strength, setStrength] = useState(0.4);
  const [showOriginal, setShowOriginal] = useState(false);
  const [magnifierMode, setMagnifierMode] = useState("edit"); 
  const [mousePos, setMousePos] = useState({
    x: -9999,
    y: -9999,
    clientX: 0,
    clientY: 0,
  });

  /* ----------------------------------------
        LOAD IMAGE
  ---------------------------------------- */
  useEffect(() => {
    if (!image || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = image;

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.drawImage(img, 0, 0);
      originalRef.current = ctx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

      displacementRef.current = Array(canvas.height)
        .fill(0)
        .map(() => Array(canvas.width).fill({ dx: 0, dy: 0 }));
    };
  }, [image]);

  /* ----------------------------------------
        UPLOAD
  ---------------------------------------- */
  const uploadImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  /* ----------------------------------------
        REDRAW
  ---------------------------------------- */
  const redraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (showOriginal) {
      ctx.putImageData(originalRef.current, 0, 0);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;

    const src = originalRef.current.data;
    const disp = displacementRef.current;
    const outImg = ctx.createImageData(w, h);
    const out = outImg.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const { dx, dy } = disp[y][x];

        const sx = Math.min(w - 1, Math.max(0, x + dx));
        const sy = Math.min(h - 1, Math.max(0, y + dy));

        const ix = Math.floor(sx);
        const iy = Math.floor(sy);

        const srcIdx = (iy * w + ix) * 4;
        const outIdx = (y * w + x) * 4;

        out[outIdx] = src[srcIdx];
        out[outIdx + 1] = src[srcIdx + 1];
        out[outIdx + 2] = src[srcIdx + 2];
        out[outIdx + 3] = 255;
      }
    }

    ctx.putImageData(outImg, 0, 0);
  };

  /* ----------------------------------------
        FAKE 3D + EDGE PROTECT
  ---------------------------------------- */
  const applyLiquify = (cx, cy, mvx = 0, mvy = 0) => {
    const canvas = canvasRef.current;
    const disp = displacementRef.current;

    const r = brushSize / 2;
    const s = strength * 2.2;

    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(canvas.width, Math.floor(cx + r));
    const y1 = Math.min(canvas.height, Math.floor(cy + r));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < r) {
          const fall = Math.exp(-(dist * dist) / (r * r));

          const radial = 1 - dist / r;
          const shading = radial * 0.25;

          const fx = (-mvx * fall * s * 0.25) + (dx * shading * 0.015);
          const fy = (-mvy * fall * s * 0.25) + (dy * shading * 0.015);

          const edgeProtect =
            1 - Math.min(1, dist / (r * 1.15));

          disp[y][x] = {
            dx: disp[y][x].dx + fx * edgeProtect,
            dy: disp[y][x].dy + fy * edgeProtect,
          };
        }
      }
    }

    redraw();
  };

  /* ----------------------------------------
        MOUSE HANDLING
  ---------------------------------------- */
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvasRef.current.width) / rect.width,
      y: ((e.clientY - rect.top) * canvasRef.current.height) / rect.height,
      clientX: e.clientX,
      clientY: e.clientY,
    };
  };

  const onDown = (e) => {
    isDrawingRef.current = true;
    const pos = getPos(e);
    lastMouseRef.current = pos;
    applyLiquify(pos.x, pos.y, 0, 0);
  };

  const onMove = (e) => {
    const pos = getPos(e);
    setMousePos(pos);

    if (!isDrawingRef.current) return;
    const last = lastMouseRef.current;

    const dx = pos.x - last.x;
    const dy = pos.y - last.y;

    lastMouseRef.current = pos;
    applyLiquify(pos.x, pos.y, dx, dy);
  };

  const onUp = () => (isDrawingRef.current = false);

  /* ----------------------------------------
        RESET
  ---------------------------------------- */
  const reset = () => {
    displacementRef.current = displacementRef.current.map((row) =>
      row.map(() => ({ dx: 0, dy: 0 }))
    );
    redraw();
  };

  /* ----------------------------------------
        DOWNLOAD
  ---------------------------------------- */
  const download = () => {
    const link = document.createElement("a");
    link.href = canvasRef.current.toDataURL("image/png");
    link.download = "edit.png";
    link.click();
  };

  /* ----------------------------------------
        MAGNIFIER MODES
        edit → imagem editada
        before_after → split
        displacement → mapa de calor
  ---------------------------------------- */
  const renderMagnifier = () => {
    if (!image) return null;
    if (!canvasRef.current) return null;
    if (mousePos.x < 0) return null;

    const size = 200;
    const zoom = 2.3;

    const canvas = canvasRef.current;

    let background;

    if (magnifierMode === "edit") {
      background = canvas.toDataURL("image/png");
    }

    if (magnifierMode === "before_after") {
      background = canvas.toDataURL("image/png"); 
    }

    if (magnifierMode === "displacement") {
      const w = canvas.width;
      const h = canvas.height;
      const disp = displacementRef.current;

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = w;
      tempCanvas.height = h;
      const ctx = tempCanvas.getContext("2d");
      const imgData = ctx.createImageData(w, h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const { dx, dy } = disp[y][x];
          const mag = Math.sqrt(dx * dx + dy * dy);
          const val = Math.min(255, mag * 40);

          const idx = (y * w + x) * 4;
          imgData.data[idx] = val;
          imgData.data[idx + 1] = 255 - val;
          imgData.data[idx + 2] = 50;
          imgData.data[idx + 3] = 255;
        }
      }

      ctx.putImageData(imgData, 0, 0);
      background = tempCanvas.toDataURL();
    }

    return (
      <div
        className="magnifier"
        style={{
          width: size,
          height: size,
          left: mousePos.clientX - size / 2,
          top: mousePos.clientY - size / 2,
          backgroundImage: `url(${background})`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${canvas.width * zoom}px ${
            canvas.height * zoom
          }px`,
          backgroundPosition: `-${
            mousePos.x * zoom - size / 2
          }px -${mousePos.y * zoom - size / 2}px`,
        }}
      >
        {magnifierMode === "before_after" && (
          <div className="split-line"></div>
        )}
      </div>
    );
  };

  /* ----------------------------------------
        UI
  ---------------------------------------- */
  return (
    <div className="liquify-wrapper">

      <div className="liquify-sidebar">
        <h4 className="fw-bold mb-3">Ortodancia Plus</h4>

        <label>Tamanho do Pincel</label>
        <input type="range" className="form-range"
          min="20" max="150"
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
        />

        <label>Força</label>
        <input type="range" className="form-range"
          min="0.1" max="1" step="0.1"
          value={strength}
          onChange={(e) => setStrength(Number(e.target.value))}
        />

        <label className="mt-3">Modo da Lupa</label>
        <select
          className="form-select mb-3"
          value={magnifierMode}
          onChange={(e) => setMagnifierMode(e.target.value)}
        >
          <option value="edit">🔍 Editado (ao vivo)</option>
          <option value="before_after">↔ Antes / Depois</option>
          <option value="displacement">🧪 Mapa de Deslocamento</option>
        </select>

        <button className="btn btn-warning w-100 my-2" onClick={reset}>
          Resetar
        </button>

        <button className="btn btn-primary w-100 my-2"
          onClick={() => {
            setShowOriginal((v) => !v);
            setTimeout(redraw, 10);
          }}>
          Antes / Depois
        </button>

        <button className="btn btn-success w-100 my-2" onClick={download}>
          Baixar
        </button>

        <label className="btn btn-dark w-100 mt-3">
          Carregar Imagem
          <input type="file" hidden accept="image/*" onChange={uploadImage} />
        </label>
      </div>

      <div className="liquify-workspace">
        {image ? (
          <>
            <canvas
              ref={canvasRef}
              className="liquify-canvas"
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            />

            {renderMagnifier()}
          </>
        ) : (
          <h5 className="text-secondary">Carregue uma imagem para começar</h5>
        )}
      </div>
    </div>
  );
};

export default LiquifyEditor;
