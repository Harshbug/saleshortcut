import React, { useEffect, useRef } from 'react';

const BackgroundMesh = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    let dots = [];
    const spacing = 28; // distance between dots
    const baseRadius = 1.2;
    const mouseRadius = 200;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initDots();
    };

    const mouse = { x: null, y: null };

    const handleMouseMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const handleMouseLeave = () => {
      mouse.x = null;
      mouse.y = null;
    };

    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseout', handleMouseLeave);

    class Dot {
      constructor(x, y) {
        this.baseX = x;
        this.baseY = y;
        this.x = x;
        this.y = y;
        this.radius = baseRadius;
        this.color = 'rgba(15, 23, 42, 0.2)'; // slate-900 with low opacity
      }

      draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      update() {
        let targetX = this.baseX;
        let targetY = this.baseY;
        let targetRadius = baseRadius;

        if (mouse.x != null && mouse.y != null) {
          let dx = mouse.x - this.baseX;
          let dy = mouse.y - this.baseY;
          let distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < mouseRadius) {
            // Normalize distance 0 to 1
            const force = (mouseRadius - distance) / mouseRadius;
            
            // Create a ripple wave effect using sine
            const time = Date.now() * 0.005;
            const wave = Math.sin(distance * 0.05 - time);
            
            // Scale radius based on distance and wave
            // Base growth + wave pulsation
            targetRadius = baseRadius + (force * 3) + (wave * force * 1.5);
            if (targetRadius < baseRadius) targetRadius = baseRadius;
            
            // Push dots away slightly based on the ripple
            const pushForce = force * 8 * Math.max(0, wave);
            if (distance > 0) {
              targetX = this.baseX - (dx / distance) * pushForce;
              targetY = this.baseY - (dy / distance) * pushForce;
            }
          }
        }

        // Ease to target values for smooth animation
        this.radius += (targetRadius - this.radius) * 0.15;
        this.x += (targetX - this.x) * 0.15;
        this.y += (targetY - this.y) * 0.15;
      }
    }

    const initDots = () => {
      dots = [];
      const cols = Math.floor(canvas.width / spacing);
      const rows = Math.floor(canvas.height / spacing);
      
      const offsetX = (canvas.width - cols * spacing) / 2;
      const offsetY = (canvas.height - rows * spacing) / 2;

      for (let i = 0; i <= cols; i++) {
        for (let j = 0; j <= rows; j++) {
          dots.push(new Dot(offsetX + i * spacing, offsetY + j * spacing));
        }
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (let i = 0; i < dots.length; i++) {
        dots[i].update();
        dots[i].draw();
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    resize();
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseout', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[-1]"
      style={{ background: 'transparent' }}
    />
  );
};

export default BackgroundMesh;
