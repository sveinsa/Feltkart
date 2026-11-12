// Enkel 360-visning (ekvirektangulært bilde på innsiden av en kule) med three.js.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export default function PanoViewer({ blob, initialHeading = 0 }: { blob: Blob; initialHeading?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Laster 360-bilde …');

  useEffect(() => {
    const host = el.current!;
    let disposed = false;
    let raf = 0;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, host.clientWidth / host.clientHeight, 1, 1100);
    const geometry = new THREE.SphereGeometry(500, 64, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    let texture: THREE.Texture | null = null;

    // Skaler ned bildet hvis det er større enn grafikkortet tåler
    (async () => {
      try {
        const bmp = await createImageBitmap(blob);
        const maxTex = Math.min(renderer.capabilities.maxTextureSize, 8192);
        const w = Math.min(bmp.width, maxTex);
        const h = Math.min(Math.round(w / 2), maxTex);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
        bmp.close?.();
        if (disposed) return;
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
        setStatus('');
      } catch (e) {
        setStatus('Kunne ikke vise bildet i 360-visning.');
      }
    })();

    let lon = initialHeading, lat = 0, fov = 75;
    let down: { x: number; y: number; lon: number; lat: number } | null = null;

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, lon, lat };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const k = fov / host.clientHeight;
      lon = down.lon - (e.clientX - down.x) * k;
      lat = Math.max(-85, Math.min(85, down.lat + (e.clientY - down.y) * k));
    };
    const onUp = () => { down = null; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      fov = Math.max(25, Math.min(100, fov + e.deltaY * 0.05));
      camera.fov = fov;
      camera.updateProjectionMatrix();
    };
    const el2 = renderer.domElement;
    el2.addEventListener('pointerdown', onDown);
    el2.addEventListener('pointermove', onMove);
    el2.addEventListener('pointerup', onUp);
    el2.addEventListener('pointercancel', onUp);
    el2.addEventListener('wheel', onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    const target = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const phi = THREE.MathUtils.degToRad(90 - lat);
      const theta = THREE.MathUtils.degToRad(lon);
      target.set(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta));
      camera.lookAt(target);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el2.removeEventListener('wheel', onWheel);
      geometry.dispose();
      material.dispose();
      texture?.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [blob, initialHeading]);

  return (
    <div className="pano" ref={el}>
      {status && <div className="pano-status">{status}</div>}
      <div className="pano-hint">Dra for å se rundt · rull for å zoome</div>
    </div>
  );
}
