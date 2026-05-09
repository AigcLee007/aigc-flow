import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface LightingThreeSceneProps {
  imageUrl: string;
  brightness: number;
  colorTemperature: number;
  viewMode: 'perspective' | 'front';
  lightVector: { x: number; y: number; z: number };
  onDragVector: (vector: { x: number; y: number; z: number }) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalize = (vector: { x: number; y: number; z: number }) => {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const kelvinToColor = (kelvin: number) => {
  const temp = kelvin / 100;
  let red = 255;
  let green = 255;
  let blue = 255;

  if (temp <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temp) - 161.1195681661;
    blue = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
    blue = 255;
  }

  return new THREE.Color(
    clamp(red, 0, 255) / 255,
    clamp(green, 0, 255) / 255,
    clamp(blue, 0, 255) / 255,
  );
};

export const LightingThreeScene: React.FC<LightingThreeSceneProps> = ({
  imageUrl,
  brightness,
  colorTemperature,
  viewMode,
  lightVector,
  onDragVector,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    photo: THREE.Mesh;
    lightGroup: THREE.Group;
    rays: THREE.Line[];
    spotLight: THREE.SpotLight;
    frameId: number;
  } | null>(null);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0, vector: lightVector });
  const viewModeRef = useRef(viewMode);
  const onDragVectorRef = useRef(onDragVector);

  useEffect(() => {
    dragRef.current.vector = lightVector;
  }, [lightVector]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    onDragVectorRef.current = onDragVector;
  }, [onDragVector]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(300, 300);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.sortObjects = true;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(2, 4, 3);
    scene.add(fill);

    const photoGeometry = new THREE.BoxGeometry(1.28, 0.9, 0.045, 1, 1, 1);
    const photoMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.04 });
    const photo = new THREE.Mesh(photoGeometry, photoMaterial);
    scene.add(photo);

    const sphereGroup = new THREE.Group();
    const radius = 1.68;
    for (let lat = -72; lat <= 72; lat += 18) {
      const phi = (90 - lat) * Math.PI / 180;
      const latRadius = radius * Math.sin(phi);
      const y = radius * Math.cos(phi);
      const curve = new THREE.EllipseCurve(0, 0, latRadius, latRadius, 0, Math.PI * 2);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.16 }),
      );
      line.rotation.x = Math.PI / 2;
      line.position.y = y;
      sphereGroup.add(line);
    }
    for (let lon = -90; lon <= 90; lon += 15) {
      const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.13 }),
      );
      line.rotation.y = lon * Math.PI / 180;
      sphereGroup.add(line);
    }
    scene.add(sphereGroup);

    const lightGroup = new THREE.Group();
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.35, metalness: 0.55 }),
    );
    lightGroup.add(orb);
    scene.add(lightGroup);

    const spotLight = new THREE.SpotLight(0xffffff, 2.5, 8, Math.PI / 6, 0.42, 1.25);
    scene.add(spotLight);
    scene.add(spotLight.target);

    const rays: THREE.Line[] = [];
    for (let i = 0; i < 240; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ray = new THREE.Line(geometry, material);
      ray.userData.angle = (i / 240) * Math.PI * 2;
      ray.userData.spread = 0.72 * Math.sqrt(i / 240);
      rays.push(ray);
      scene.add(ray);
    }

    const animate = () => {
      renderer.render(scene, camera);
      sceneRef.current!.frameId = requestAnimationFrame(animate);
    };

    sceneRef.current = { renderer, scene, camera, photo, lightGroup, rays, spotLight, frameId: 0 };
    animate();

    const onPointerDown = (event: PointerEvent) => {
      dragRef.current.dragging = true;
      dragRef.current.lastX = event.clientX;
      dragRef.current.lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = event.clientX - dragRef.current.lastX;
      const dy = event.clientY - dragRef.current.lastY;
      dragRef.current.lastX = event.clientX;
      dragRef.current.lastY = event.clientY;
      const current = normalize(dragRef.current.vector);
      const theta = Math.atan2(current.x, current.z) + dx * 0.012;
      const phi = clamp(Math.asin(clamp(current.y, -0.99, 0.99)) - dy * 0.012, -1.22, 1.22);
      const next = normalize({
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.sin(phi),
        z: viewModeRef.current === 'front' ? Math.abs(Math.cos(theta) * Math.cos(phi)) : Math.cos(theta) * Math.cos(phi),
      });
      dragRef.current.vector = next;
      onDragVectorRef.current(next);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragRef.current.dragging = false;
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {}
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);

    return () => {
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      if (sceneRef.current) cancelAnimationFrame(sceneRef.current.frameId);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const loader = new THREE.TextureLoader();
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
      const material = state.photo.material as THREE.MeshStandardMaterial;
      material.map?.dispose?.();
      material.map = texture;
      material.needsUpdate = true;
    });
  }, [imageUrl]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const vector = normalize(lightVector);
    const radius = 1.72;
    const position = new THREE.Vector3(vector.x * radius, -vector.y * radius, vector.z * radius);
    state.camera.position.set(viewMode === 'perspective' ? 2.2 : 0, viewMode === 'perspective' ? 1.1 : 0, 5);
    state.camera.lookAt(0, 0, 0);
    state.photo.rotation.y = viewMode === 'perspective' ? -0.42 : 0;
    state.photo.rotation.x = viewMode === 'perspective' ? 0.12 : 0;
    state.lightGroup.position.copy(position);
    state.lightGroup.lookAt(0, 0, 0);
    state.spotLight.position.copy(position);
    state.spotLight.target.position.set(0, 0, 0);

    const color = kelvinToColor(colorTemperature);
    const intensity = 0.35 + brightness / 55;
    state.spotLight.color = color;
    state.spotLight.intensity = intensity;

    state.rays.forEach((ray) => {
      const angle = ray.userData.angle as number;
      const spread = ray.userData.spread as number;
      const direction = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), position).normalize();
      const tangent = new THREE.Vector3(Math.cos(angle) * spread, Math.sin(angle) * spread, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
      tangent.applyQuaternion(quaternion);
      const end = tangent.multiplyScalar(0.58).add(new THREE.Vector3(0, 0, 0));
      const start = position.clone().add(direction.clone().multiplyScalar(0.08));
      const positions = ray.geometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(0, start.x, start.y, start.z);
      positions.setXYZ(1, end.x, end.y, end.z);
      positions.needsUpdate = true;
      const material = ray.material as THREE.LineBasicMaterial;
      material.color = color;
      material.opacity = 0.02 + brightness / 900;
    });
  }, [brightness, colorTemperature, lightVector, viewMode]);

  return <div ref={containerRef} style={sceneContainerStyle} />;
};

const sceneContainerStyle: React.CSSProperties = {
  width: 300,
  height: 300,
  borderRadius: 18,
  overflow: 'hidden',
  cursor: 'grab',
  background: 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08), rgba(0,0,0,0.08) 55%, rgba(0,0,0,0.22))',
  border: '1px solid rgba(255,255,255,0.08)',
};
