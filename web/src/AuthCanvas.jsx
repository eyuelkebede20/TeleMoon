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

    // Prefers reduced motion check
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Mouse coordinates for gentle interactive fluid disturbance
    const mouse = { x: -1000, y: -1000, active: false };

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

    // Floating liquid orbs (viscous metaball-like fluid droplets)
    const orbs = Array.from({ length: 9 }, (_, i) => ({
      x: Math.random() * (width || 800),
      y: Math.random() * (height || 600),
      r: 28 + Math.random() * 48,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -0.2 - Math.random() * 0.35,
      phase: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.015 + Math.random() * 0.02,
      color: i % 3 === 0 ? "rgba(81, 108, 141, " : i % 3 === 1 ? "rgba(48, 65, 99, " : "rgba(126, 163, 204, ",
    }));

    // Liquid ripples triggered by plane or mouse
    const ripples = [];

    // Liquid wake particles emitted by flying plane
    const wake = [];

    // Flying Telegram paper airplane state (prominent, large scale)
    const plane = {
      t: 0,
      x: width * 0.2,
      y: height * 0.4,
      vx: 1,
      vy: 0,
      angle: 0,
      bank: 0,
      size: Math.max(130, Math.min(210, width * 0.14)),
    };

    let lastTime = performance.now();

    function render(currentTime) {
      if (prefersReducedMotion) {
        // Simple static backdrop for reduced motion
        ctx.fillStyle = "#28385e";
        ctx.fillRect(0, 0, width, height);
        return;
      }

      const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;
      const t = currentTime * 0.001;

      // Update plane size on window sizing
      plane.size = Math.max(130, Math.min(210, width * 0.14));

      // 1. Solid base gradient background (#28385e to #1f2c4a)
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, "#28385e");
      bgGrad.addColorStop(0.5, "#253457");
      bgGrad.addColorStop(1, "#1c2742");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Floating Viscous Liquid Orbs
      for (const orb of orbs) {
        orb.x += orb.vx;
        orb.y += orb.vy;
        orb.phase += orb.wobbleSpeed;

        // Wrap around smoothly
        if (orb.y < -orb.r * 2) {
          orb.y = height + orb.r;
          orb.x = Math.random() * width;
        }
        if (orb.x < -orb.r * 2) orb.x = width + orb.r;
        if (orb.x > width + orb.r * 2) orb.x = -orb.r;

        // Interactive mouse swell
        let swell = 0;
        if (mouse.active) {
          const dx = orb.x - mouse.x;
          const dy = orb.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            swell = (1 - dist / 150) * 12;
            orb.x += (dx / dist) * 0.8;
            orb.y += (dy / dist) * 0.8;
          }
        }

        drawLiquidOrb(ctx, orb.x, orb.y, orb.r + swell, orb.phase, orb.color);
      }

      // 4. Update & Draw Ripples
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
        ctx.strokeStyle = `rgba(126, 163, 204, ${rip.alpha * 0.45})`;
        ctx.lineWidth = rip.width || 1.8;
        ctx.stroke();
        ctx.restore();
      }

      // 5. Update & Draw Flying Telegram Airplane (Large, cinematic flight)
      plane.t += dt * 0.55;
      const pt = plane.t;

      // Complex, organic 3D-like parametric flight path traversing the canvas
      const cx = width * 0.5;
      const cy = height * 0.44;
      const rx = width * 0.40;
      const ry = height * 0.32;

      // Figure-8 with harmonic vertical dips
      const targetX = cx + Math.sin(pt) * rx + Math.sin(pt * 2.3) * (rx * 0.15);
      const targetY = cy + Math.sin(pt * 2) * ry * 0.75 + Math.cos(pt * 1.4) * (ry * 0.25);

      // Smooth velocity & angle calculation
      const dx = targetX - plane.x;
      const dy = targetY - plane.y;
      plane.vx = dx * 0.12;
      plane.vy = dy * 0.12;
      plane.x += plane.vx;
      plane.y += plane.vy;

      const targetAngle = Math.atan2(plane.vy, plane.vx);
      // Angular smoothing
      let diff = targetAngle - plane.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      plane.angle += diff * 0.14;
      plane.bank = diff * 4.5; // banking into turns

      // Twin wingtip & tail contrail emission points
      const s = plane.size / 24;
      const cosA = Math.cos(plane.angle);
      const sinA = Math.sin(plane.angle);

      // Transform local plane coordinates to global coordinates
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

      // Emit glowing liquid droplets from wingtips & tail
      if (Math.random() < 0.85) {
        wake.push({
          x: leftTip.x + (Math.random() - 0.5) * 4,
          y: leftTip.y + (Math.random() - 0.5) * 4,
          vx: -cosA * 0.5 + (Math.random() - 0.5) * 0.4,
          vy: -sinA * 0.5 + (Math.random() - 0.5) * 0.4,
          r: 3 + Math.random() * 4.5,
          alpha: 0.85,
          decay: 0.015,
        });
        wake.push({
          x: rightTip.x + (Math.random() - 0.5) * 4,
          y: rightTip.y + (Math.random() - 0.5) * 4,
          vx: -cosA * 0.5 + (Math.random() - 0.5) * 0.4,
          vy: -sinA * 0.5 + (Math.random() - 0.5) * 0.4,
          r: 3 + Math.random() * 4.5,
          alpha: 0.85,
          decay: 0.015,
        });
      }

      if (Math.random() < 0.6) {
        wake.push({
          x: tail.x,
          y: tail.y,
          vx: -cosA * 0.8 + (Math.random() - 0.5) * 0.3,
          vy: -sinA * 0.8 + (Math.random() - 0.5) * 0.3,
          r: 4 + Math.random() * 5.5,
          alpha: 0.9,
          decay: 0.012,
        });
      }

      // Update & Draw Wake Particles
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
        ctx.fillStyle = `rgba(126, 163, 204, ${p.alpha * 0.75})`;
        ctx.shadowColor = "rgba(126, 163, 204, 0.9)";
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.restore();
      }

      // Draw Flying Telegram Airplane (Big & Highly Visible)
      drawTelegramPlane(ctx, plane.x, plane.y, plane.angle, plane.bank, plane.size);

      // Subtle ambient vignette overlay
      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        Math.min(width, height) * 0.3,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85
      );
      vig.addColorStop(0, "rgba(40, 56, 94, 0)");
      vig.addColorStop(1, "rgba(20, 28, 48, 0.65)");
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


/**
 * Draws a viscous organic fluid orb / droplet with surface deformation
 */
function drawLiquidOrb(ctx, cx, cy, radius, phase, baseColor) {
  ctx.save();
  ctx.beginPath();

  const points = 12;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    // Harmonic surface wobble
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

  // Internal fluid gradient
  const grad = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.3,
    radius * 0.1,
    cx,
    cy,
    radius * 1.1
  );
  grad.addColorStop(0, `${baseColor}0.4)`);
  grad.addColorStop(0.7, `${baseColor}0.18)`);
  grad.addColorStop(1, `${baseColor}0.02)`);

  ctx.fillStyle = grad;
  ctx.fill();

  // Specular rim
  ctx.strokeStyle = `${baseColor}0.35)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Draws the iconic Telegram logo (circular emblem with 3D faceted paper airplane)
 */
function drawTelegramPlane(ctx, x, y, angle, bank, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Bank perspective foreshortening
  const bankScaleY = Math.max(0.48, 1 - Math.abs(bank) * 0.22);
  ctx.scale(1, bankScaleY);

  const s = size / 24;

  // 1. Telegram Luminous Circular Emblem Background Disk
  const diskR = 19 * s;
  const diskGrad = ctx.createRadialGradient(-2 * s, -2 * s, diskR * 0.2, 0, 0, diskR);
  diskGrad.addColorStop(0, "rgba(81, 108, 141, 0.45)");
  diskGrad.addColorStop(0.7, "rgba(48, 65, 99, 0.35)");
  diskGrad.addColorStop(1, "rgba(40, 56, 94, 0.08)");

  ctx.beginPath();
  ctx.arc(0, 0, diskR, 0, Math.PI * 2);
  ctx.fillStyle = diskGrad;
  ctx.fill();

  // Emblem glowing outer rim
  ctx.strokeStyle = "rgba(126, 163, 204, 0.4)";
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.stroke();

  // 2. High-Visibility Ambient Neon Aura around the Airplane
  ctx.shadowColor = "rgba(126, 163, 204, 0.95)";
  ctx.shadowBlur = Math.max(20, 24 * s);

  // 3. Facet 1: Main Upper Wing (Luminous White & Light Slate Gradient)
  const topWingGrad = ctx.createLinearGradient(16 * s, -2 * s, -12 * s, -12 * s);
  topWingGrad.addColorStop(0, "#ffffff");
  topWingGrad.addColorStop(0.65, "#e6edf5");
  topWingGrad.addColorStop(1, "#c8d8ea");

  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s); // Nose
  ctx.lineTo(-12 * s, -12 * s); // Left wing tip
  ctx.lineTo(-4 * s, 0); // Crease fold
  ctx.closePath();
  ctx.fillStyle = topWingGrad;
  ctx.fill();

  // 4. Facet 2: Bottom Fold / Right Wing (Telegram Sky Cyan & Steel Blue)
  const botWingGrad = ctx.createLinearGradient(15 * s, -1 * s, -10 * s, 12 * s);
  botWingGrad.addColorStop(0, "#a5c9f3");
  botWingGrad.addColorStop(0.5, "#7ea3cc");
  botWingGrad.addColorStop(1, "#516c8d");

  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s); // Nose
  ctx.lineTo(-4 * s, 0); // Crease fold
  ctx.lineTo(-10 * s, 12 * s); // Right wing tip
  ctx.closePath();
  ctx.fillStyle = botWingGrad;
  ctx.fill();

  // 5. Facet 3: Keel / Rudder Underside Shadow (Navy Depth)
  const keelGrad = ctx.createLinearGradient(-4 * s, 0, -10 * s, 12 * s);
  keelGrad.addColorStop(0, "#485f8f");
  keelGrad.addColorStop(1, "#28385e");

  ctx.beginPath();
  ctx.moveTo(-4 * s, 0);
  ctx.lineTo(-10 * s, 12 * s);
  ctx.lineTo(-5 * s, 4 * s);
  ctx.closePath();
  ctx.fillStyle = keelGrad;
  ctx.fill();

  // 6. Crisp Edge Bevel & Crease Lines
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.beginPath();
  // Nose to tips
  ctx.moveTo(15 * s, -1 * s);
  ctx.lineTo(-12 * s, -12 * s);
  ctx.lineTo(-4 * s, 0);
  ctx.lineTo(15 * s, -1 * s);
  ctx.lineTo(-10 * s, 12 * s);
  ctx.stroke();

  // Wing crease center line
  ctx.strokeStyle = "rgba(126, 163, 204, 0.9)";
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.beginPath();
  ctx.moveTo(15 * s, -1 * s);
  ctx.lineTo(-4 * s, 0);
  ctx.stroke();

  ctx.restore();
}
