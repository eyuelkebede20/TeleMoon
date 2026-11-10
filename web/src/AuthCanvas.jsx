import { useEffect, useRef } from "react";

export default function AuthCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let animId;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: -1000, y: -1000, active: false };

    function isLightMode() {
      return document.documentElement.getAttribute("data-theme") === "light";
    }

    function resize() {
      if (!canvas) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
      height = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);
    }

    resize();
    window.addEventListener("resize", resize);

    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }

    function onMouseLeave() {
      mouse.active = false;
      mouse.x = -1000;
      mouse.y = -1000;
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);

    // Liquid metaball-like fluid droplets
    const orbs = Array.from({ length: 9 }, (_, i) => ({
      x: Math.random() * (width || 800),
      y: Math.random() * (height || 600),
      r: 28 + Math.random() * 46,
      vx: (Math.random() - 0.5) * 0.32,
      vy: -0.2 - Math.random() * 0.32,
      phase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.015 + Math.random() * 0.02,
      typeIndex: i % 3,
    }));

    const ripples = [];
    const wake = [];

    const plane = {
      t: 0,
      x: width * 0.25,
      y: height * 0.45,
      vx: 1,
      vy: 0,
      angle: 0,
      bank: 0,
      size: Math.max(120, Math.min(190, (width || 800) * 0.13)),
    };

    let lastTime = performance.now();

    function render(currentTime) {
      const light = isLightMode();

      if (prefersReducedMotion) {
        ctx.fillStyle = light ? "#FAF7F2" : "#0e1220";
        ctx.fillRect(0, 0, width, height);
        return;
      }

      const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;
      const t = currentTime * 0.001;

      plane.size = Math.max(120, Math.min(190, width * 0.13));

      // 1. Signature TeleMoon background gradient (#0e1220 -> #121730 -> #090d18)
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      if (light) {
        bgGrad.addColorStop(0, "#FAF7F2");
        bgGrad.addColorStop(0.5, "#F0EAE1");
        bgGrad.addColorStop(1, "#E5DFD3");
      } else {
        bgGrad.addColorStop(0, "#0e1220");
        bgGrad.addColorStop(0.5, "#121730");
        bgGrad.addColorStop(1, "#090d18");
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Floating Liquid Orbs
      for (const orb of orbs) {
        orb.x += orb.vx;
        orb.y += orb.vy;
        orb.phase += orb.wobbleSpeed;

        if (orb.y < -orb.r * 2) {
          orb.y = height + orb.r;
          orb.x = Math.random() * width;
        }
        if (orb.x < -orb.r * 2) orb.x = width + orb.r;
        if (orb.x > width + orb.r * 2) orb.x = -orb.r;

        let swell = 0;
        if (mouse.active) {
          const dx = orb.x - mouse.x;
          const dy = orb.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            swell = (1 - dist / 150) * 12;
            orb.x += (dx / dist) * 0.7;
            orb.y += (dy / dist) * 0.7;
          }
        }

        const baseColor = light
          ? (orb.typeIndex === 0 ? "rgba(196, 135, 34, " : orb.typeIndex === 1 ? "rgba(206, 197, 180, " : "rgba(29, 100, 216, ")
          : (orb.typeIndex === 0 ? "rgba(57, 66, 110, " : orb.typeIndex === 1 ? "rgba(29, 35, 64, " : "rgba(143, 180, 255, ");

        drawLiquidOrb(ctx, orb.x, orb.y, orb.r + swell, orb.phase, baseColor);
      }

      // 3. Ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rip = ripples[i];
        rip.r += rip.vr * dt * 60;
        rip.alpha -= rip.decay * dt * 60;

        if (rip.alpha <= 0.01) {
          ripples.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
        ctx.strokeStyle = light
          ? `rgba(29, 100, 216, ${rip.alpha * 0.35})`
          : `rgba(143, 180, 255, ${rip.alpha * 0.35})`;
        ctx.lineWidth = rip.width || 1.6;
        ctx.stroke();
        ctx.restore();
      }

      // 4. Flying Telegram Airplane kinematics
      plane.t += dt * 0.52;
      const pt = plane.t;

      const cx = width * 0.5;
      const cy = height * 0.44;
      const rx = width * 0.38;
      const ry = height * 0.30;

      const targetX = cx + Math.sin(pt) * rx + Math.sin(pt * 2.3) * (rx * 0.14);
      const targetY = cy + Math.sin(pt * 2) * ry * 0.7 + Math.cos(pt * 1.4) * (ry * 0.22);

      const dx = targetX - plane.x;
      const dy = targetY - plane.y;
      plane.vx = dx * 0.12;
      plane.vy = dy * 0.12;
      plane.x += plane.vx;
      plane.y += plane.vy;

      const targetAngle = Math.atan2(plane.vy, plane.vx);
      let diff = targetAngle - plane.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      plane.angle += diff * 0.14;
      plane.bank = diff * 4.5;

      const s = plane.size / 24;
      const cosA = Math.cos(plane.angle);
      const sinA = Math.sin(plane.angle);

      function toGlobal(lx, ly) {
        const by = ly * Math.max(0.45, 1 - Math.abs(plane.bank) * 0.25);
        return {
          x: plane.x + (lx * cosA - by * sinA),
          y: plane.y + (lx * sinA + by * cosA),
        };
      }

      const leftTip = toGlobal(-12 * s, -11 * s);
      const rightTip = toGlobal(-10 * s, 11 * s);
      const tail = toGlobal(-4 * s, 0);

      // Emit wake droplets
      if (Math.random() < 0.8) {
        const isGold = Math.random() < 0.25;
        wake.push({
          x: leftTip.x + (Math.random() - 0.5) * 4,
          y: leftTip.y + (Math.random() - 0.5) * 4,
          vx: -cosA * 0.5 + (Math.random() - 0.5) * 0.3,
          vy: -sinA * 0.5 + (Math.random() - 0.5) * 0.3,
          r: 2.8 + Math.random() * 4,
          alpha: 0.8,
          decay: 0.016,
          isGold,
        });
        wake.push({
          x: rightTip.x + (Math.random() - 0.5) * 4,
          y: rightTip.y + (Math.random() - 0.5) * 4,
          vx: -cosA * 0.5 + (Math.random() - 0.5) * 0.3,
          vy: -sinA * 0.5 + (Math.random() - 0.5) * 0.3,
          r: 2.8 + Math.random() * 4,
          alpha: 0.8,
          decay: 0.016,
          isGold,
        });
      }

      if (Math.random() < 0.5) {
        wake.push({
          x: tail.x,
          y: tail.y,
          vx: -cosA * 0.8 + (Math.random() - 0.5) * 0.25,
          vy: -sinA * 0.8 + (Math.random() - 0.5) * 0.25,
          r: 3.5 + Math.random() * 4.5,
          alpha: 0.85,
          decay: 0.014,
          isGold: false,
        });
      }

      // Draw wake particles
      for (let i = wake.length - 1; i >= 0; i--) {
        const p = wake[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        p.r *= 0.985;

        if (p.alpha <= 0.02 || p.r <= 0.5) {
          wake.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);

        if (p.isGold) {
          ctx.fillStyle = light ? `rgba(196, 135, 34, ${p.alpha * 0.8})` : `rgba(240, 217, 168, ${p.alpha * 0.85})`;
          ctx.shadowColor = light ? "rgba(196, 135, 34, 0.7)" : "rgba(240, 217, 168, 0.9)";
        } else {
          ctx.fillStyle = light ? `rgba(29, 100, 216, ${p.alpha * 0.7})` : `rgba(143, 180, 255, ${p.alpha * 0.75})`;
          ctx.shadowColor = light ? "rgba(29, 100, 216, 0.6)" : "rgba(143, 180, 255, 0.85)";
        }
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
      }

      // Draw Airplane
      drawTelegramPlane(ctx, plane.x, plane.y, plane.angle, plane.bank, plane.size, light);

      // Ambient vignette overlay
      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.3,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85
      );
      if (light) {
        vig.addColorStop(0, "rgba(250, 247, 242, 0)");
        vig.addColorStop(1, "rgba(215, 205, 190, 0.5)");
      } else {
        vig.addColorStop(0, "rgba(14, 18, 32, 0)");
        vig.addColorStop(1, "rgba(8, 11, 20, 0.65)");
      }
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-liquid-canvas" aria-hidden="true" />;
}

function drawLiquidOrb(ctx, cx, cy, radius, phase, baseColor) {
  ctx.save();
  ctx.beginPath();

  const points = 12;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const deformation =
      Math.sin(angle * 3 + phase) * (radius * 0.12) +
      Math.cos(angle * 2 - phase * 1.2) * (radius * 0.08);
    const r = radius + deformation;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.closePath();

  const grad = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.3,
    radius * 0.1,
    cx,
    cy,
    radius * 1.1
  );
  grad.addColorStop(0, `${baseColor}0.38)`);
  grad.addColorStop(0.7, `${baseColor}0.16)`);
  grad.addColorStop(1, `${baseColor}0.02)`);

  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = `${baseColor}0.3)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawTelegramPlane(ctx, x, y, angle, bank, size, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const bankScaleY = Math.max(0.48, 1 - Math.abs(bank) * 0.22);
  ctx.scale(1, bankScaleY);

  const s = size / 24;

  // Luminous Emblem Disk
  const diskR = 19 * s;
  const diskGrad = ctx.createRadialGradient(-2 * s, -2 * s, diskR * 0.2, 0, 0, diskR);
  if (light) {
    diskGrad.addColorStop(0, "rgba(29, 100, 216, 0.25)");
    diskGrad.addColorStop(0.7, "rgba(229, 223, 211, 0.3)");
    diskGrad.addColorStop(1, "rgba(250, 247, 242, 0.05)");
  } else {
    diskGrad.addColorStop(0, "rgba(57, 66, 110, 0.45)");
    diskGrad.addColorStop(0.7, "rgba(29, 35, 64, 0.35)");
    diskGrad.addColorStop(1, "rgba(14, 18, 32, 0.08)");
  }

  ctx.beginPath();
  ctx.arc(0, 0, diskR, 0, Math.PI * 2);
  ctx.fillStyle = diskGrad;
  ctx.fill();

  ctx.strokeStyle = light ? "rgba(29, 100, 216, 0.35)" : "rgba(143, 180, 255, 0.4)";
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.stroke();

  // Aura
  ctx.shadowColor = light ? "rgba(29, 100, 216, 0.8)" : "rgba(143, 180, 255, 0.9)";
  ctx.shadowBlur = Math.max(18, 22 * s);

  // Facet 1: Top Wing (White / Sky Slate)
  const topWingGrad = ctx.createLinearGradient(16 * s, -2 * s, -12 * s, -12 * s);
  topWingGrad.addColorStop(0, "#ffffff");
  topWingGrad.addColorStop(0.65, light ? "#eef2f7" : "#e0e7f5");
  topWingGrad.addColorStop(1, light ? "#bad0f3" : "#8fb4ff");

  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s);
  ctx.lineTo(-12 * s, -12 * s);
  ctx.lineTo(-4 * s, 0);
  ctx.closePath();
  ctx.fillStyle = topWingGrad;
  ctx.fill();

  // Facet 2: Bottom Wing / Fold
  const botWingGrad = ctx.createLinearGradient(15 * s, -1 * s, -10 * s, 12 * s);
  botWingGrad.addColorStop(0, light ? "#8fb4ff" : "#8fb4ff");
  botWingGrad.addColorStop(0.5, light ? "#4878d4" : "#4f6fad");
  botWingGrad.addColorStop(1, light ? "#234994" : "#262d4a");

  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s);
  ctx.lineTo(-4 * s, 0);
  ctx.lineTo(-10 * s, 12 * s);
  ctx.closePath();
  ctx.fillStyle = botWingGrad;
  ctx.fill();

  // Facet 3: Keel
  const keelGrad = ctx.createLinearGradient(-4 * s, 0, -10 * s, 12 * s);
  keelGrad.addColorStop(0, light ? "#2d549e" : "#2c3b5d");
  keelGrad.addColorStop(1, light ? "#1a3363" : "#0e1220");

  ctx.beginPath();
  ctx.moveTo(-4 * s, 0);
  ctx.lineTo(-10 * s, 12 * s);
  ctx.lineTo(-5 * s, 4 * s);
  ctx.closePath();
  ctx.fillStyle = keelGrad;
  ctx.fill();

  // Crisp Edges
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s);
  ctx.lineTo(-12 * s, -12 * s);
  ctx.lineTo(-4 * s, 0);
  ctx.lineTo(15 * s, -1 * s);
  ctx.lineTo(-10 * s, 12 * s);
  ctx.stroke();

  // Crease Line
  ctx.strokeStyle = light ? "rgba(29, 100, 216, 0.85)" : "rgba(143, 180, 255, 0.85)";
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s);
  ctx.lineTo(-4 * s, 0);
  ctx.stroke();

  ctx.restore();
}
