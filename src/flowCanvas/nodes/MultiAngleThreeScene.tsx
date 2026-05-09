import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface MultiAngleThreeSceneProps {
  imageUrl: string;
  mode: 'subject' | 'camera';
  rotation: number;
  tilt: number;
  zoom: number;
  onDrag: (deltaX: number, deltaY: number) => void;
}

const getScale = (zoom: number) => {
  if (zoom <= 25) return 1.48;
  if (zoom >= 75) return 0.88;
  return 1.14;
};

export const MultiAngleThreeScene: React.FC<MultiAngleThreeSceneProps> = ({
  imageUrl,
  mode,
  rotation,
  tilt,
  zoom,
  onDrag,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    cubeGroup: THREE.Group;
    sphereGroup: THREE.Group;
    cameraGroup: THREE.Group;
    connectionLine: THREE.Mesh;
    frontFace: THREE.Mesh;
    cameraScreens: THREE.Mesh[];
    frameId: number;
  } | null>(null);
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const onDragRef = useRef(onDrag);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    camera.position.z = 5.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(300, 300);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.sortObjects = true;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.58));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(3, 5, 4);
    scene.add(key);
    const back = new THREE.DirectionalLight(0xffffff, 0.35);
    back.position.set(-3, -2, -4);
    scene.add(back);

    const cubeGroup = createCubeGroup();
    scene.add(cubeGroup);

    const sphereGroup = createSphereGrid();
    scene.add(sphereGroup);

    const { cameraGroup, screens } = createCameraModel();
    scene.add(cameraGroup);

    const connectionLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 1, 12),
      new THREE.MeshBasicMaterial({ color: 0xd6d6d6, transparent: true, opacity: 0.76, depthTest: false }),
    );
    connectionLine.renderOrder = 1000;
    scene.add(connectionLine);

    const animate = () => {
      renderer.render(scene, camera);
      stateRef.current!.frameId = requestAnimationFrame(animate);
    };

    stateRef.current = {
      renderer,
      scene,
      camera,
      cubeGroup,
      sphereGroup,
      cameraGroup,
      connectionLine,
      frontFace: cubeGroup.children[0] as THREE.Mesh,
      cameraScreens: screens,
      frameId: 0,
    };
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
      onDragRef.current(dx, dy);
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
      if (stateRef.current) cancelAnimationFrame(stateRef.current.frameId);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose?.();
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const loader = new THREE.TextureLoader();
    loader.load(imageUrl, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
      applyTexture(state.frontFace, texture);
      state.cameraScreens.forEach((screen) => applyTexture(screen, texture.clone()));
    });
  }, [imageUrl]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const scale = getScale(zoom);

    if (mode === 'subject') {
      state.cubeGroup.visible = true;
      state.sphereGroup.visible = false;
      state.cameraGroup.visible = false;
      state.connectionLine.visible = false;
      state.cubeGroup.position.set(0, 0, 0);
      state.cubeGroup.rotation.x = THREE.MathUtils.degToRad(tilt);
      state.cubeGroup.rotation.y = THREE.MathUtils.degToRad(-rotation);
      state.cubeGroup.scale.setScalar(scale);
    } else {
      state.cubeGroup.visible = true;
      state.sphereGroup.visible = true;
      state.cameraGroup.visible = true;
      state.connectionLine.visible = true;
      state.cubeGroup.position.set(0, 0, -1.62);
      state.cubeGroup.rotation.set(0, 0, 0);
      state.cubeGroup.scale.setScalar(scale * 0.82);

      const radius = 1.32;
      const theta = THREE.MathUtils.degToRad(rotation);
      const phi = THREE.MathUtils.degToRad(-tilt);
      const cameraPosition = new THREE.Vector3(
        radius * Math.cos(phi) * Math.sin(theta),
        radius * Math.sin(phi),
        radius * Math.cos(phi) * Math.cos(theta),
      );
      state.cameraGroup.position.copy(cameraPosition);
      state.cameraGroup.lookAt(0, 0, -1.62);
      state.sphereGroup.rotation.x = THREE.MathUtils.degToRad(-tilt);
      state.sphereGroup.rotation.y = THREE.MathUtils.degToRad(rotation);
      updateConnectionLine(state.connectionLine, new THREE.Vector3(0, 0, -1.62), cameraPosition);
    }
  }, [mode, rotation, tilt, zoom]);

  return <div ref={containerRef} style={sceneContainerStyle} />;
};

const applyTexture = (mesh: THREE.Mesh, texture: THREE.Texture) => {
  if (Array.isArray(mesh.material)) {
    const frontMaterial = mesh.material[4] as THREE.MeshPhongMaterial | THREE.MeshBasicMaterial;
    frontMaterial.map?.dispose?.();
    frontMaterial.map = texture;
    frontMaterial.needsUpdate = true;
    return;
  }
  const material = mesh.material as THREE.MeshPhongMaterial | THREE.MeshBasicMaterial;
  material.map?.dispose?.();
  material.map = texture;
  material.needsUpdate = true;
};

const createCubeGroup = () => {
  const group = new THREE.Group();
  const size = 0.82;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const materials = [
    new THREE.MeshPhongMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.82 }),
    new THREE.MeshPhongMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.82 }),
    new THREE.MeshPhongMaterial({ color: 0xdddddd, transparent: true, opacity: 0.75 }),
    new THREE.MeshPhongMaterial({ color: 0xdddddd, transparent: true, opacity: 0.75 }),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    new THREE.MeshPhongMaterial({ color: 0x2d2d2d, transparent: true, opacity: 0.8 }),
  ];
  const cube = new THREE.Mesh(geometry, materials);
  group.add(cube);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2 }),
  );
  group.add(edges);
  return group;
};

const createSphereGrid = () => {
  const group = new THREE.Group();
  const radius = 1.38;
  for (let lat = -72; lat <= 72; lat += 18) {
    const phi = (90 - lat) * Math.PI / 180;
    const latRadius = radius * Math.sin(phi);
    const y = radius * Math.cos(phi);
    const curve = new THREE.EllipseCurve(0, 0, latRadius, latRadius, 0, Math.PI * 2);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)),
      new THREE.LineBasicMaterial({ color: 0xa3a3a3, transparent: true, opacity: 0.16 }),
    );
    line.rotation.x = Math.PI / 2;
    line.position.y = y;
    group.add(line);
  }
  for (let lon = -90; lon <= 90; lon += 12) {
    const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)),
      new THREE.LineBasicMaterial({ color: 0xa3a3a3, transparent: true, opacity: 0.14 }),
    );
    line.rotation.y = lon * Math.PI / 180;
    group.add(line);
  }
  group.visible = false;
  return group;
};

const createCameraModel = () => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.3, 0.18),
    new THREE.MeshPhongMaterial({ color: 0xf7f7f7, shininess: 80 }),
  );
  group.add(body);
  const screens = [0.095, -0.095].map((z) => {
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.21),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    );
    screen.position.z = z;
    screen.rotation.y = z < 0 ? Math.PI : 0;
    group.add(screen);
    return screen;
  });
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.015, 24),
    new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 }),
  );
  button.rotation.x = Math.PI / 2;
  button.position.set(-0.14, 0.16, 0.03);
  group.add(button);
  group.visible = false;
  return { cameraGroup: group, screens };
};

const updateConnectionLine = (line: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) => {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  const midpoint = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
  line.position.copy(midpoint);
  line.scale.set(1, length, 1);
  line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
};

const sceneContainerStyle: React.CSSProperties = {
  width: 300,
  height: 300,
  borderRadius: 18,
  overflow: 'hidden',
  cursor: 'grab',
  background: 'radial-gradient(circle at 50% 48%, rgba(255,255,255,0.08), rgba(0,0,0,0.08) 55%, rgba(0,0,0,0.22))',
  border: '1px solid rgba(255,255,255,0.08)',
};
