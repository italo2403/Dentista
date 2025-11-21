import React, { useState } from "react";
import Face from "./face";
import Dente from "./dente";
import "./assets/style.css";

export default function App() {
  const [screen, setScreen] = useState(null);

  if (screen === "face") return <Face goBack={() => setScreen(null)} />;
  if (screen === "dente") return <Dente goBack={() => setScreen(null)} />;

  return (
    <div className="menu-container">
      <h1 className="title">🦷 Sistema Odonto Simples</h1>

      <div className="menu-grid">
        <button className="menu-btn" onClick={() => setScreen("face")}>
          😁 Tratamento Facial
        </button>

        <button className="menu-btn" onClick={() => setScreen("dente")}>
          🦷 Editor de Dentes
        </button>
      </div>
    </div>
  );
}
