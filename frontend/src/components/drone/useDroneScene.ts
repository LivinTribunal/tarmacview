import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  addStudioLights,
  centerAndScaleModel,
  computeFitCamera,
  disposeScene,
} from "./threeSceneSetup";

// resume idle auto-rotate this long after the user stops dragging.
const AUTO_ROTATE_RESUME_MS = 3000;

interface UseDroneSceneOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  modelUrl: string | null;
  autoRotate: boolean;
  backgroundColor: string;
  onSceneLoaded?: (gltf: GLTF) => void;
}

interface UseDroneSceneResult {
  loading: boolean;
  error: boolean;
  resetCamera: () => void;
}

/** owns the renderer/scene/camera/controls lifecycle for the live drone viewer. */
export default function useDroneScene({
  containerRef,
  modelUrl,
  autoRotate,
  backgroundColor,
  onSceneLoaded,
}: UseDroneSceneOptions): UseDroneSceneResult {
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<number>(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const defaultCameraPos = useRef(new THREE.Vector3(0, 1.5, 3));

  const resetCamera = useCallback(() => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.copy(defaultCameraPos.current);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!modelUrl) return;

    const container = containerRef.current;
    setLoading(true);
    setError(false);

    // renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: backgroundColor === "transparent",
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(container.clientWidth, container.clientHeight);
    if (backgroundColor !== "transparent") {
      renderer.setClearColor(new THREE.Color(backgroundColor));
    }
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.01,
      100,
    );
    camera.position.copy(defaultCameraPos.current);
    cameraRef.current = camera;

    addStudioLights(scene);

    // controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 8;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.5;
    controlsRef.current = controls;

    // pause auto-rotate while the user is interacting, resume once idle
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    });
    controls.addEventListener("end", () => {
      if (!autoRotate) return;
      resumeTimerRef.current = setTimeout(() => {
        controls.autoRotate = true;
      }, AUTO_ROTATE_RESUME_MS);
    });

    // load model
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        const model = gltf.scene;
        centerAndScaleModel(model);
        scene.add(model);

        const fit = computeFitCamera(model, camera);
        camera.position.copy(fit.position);
        controls.target.copy(fit.target);
        controls.update();
        defaultCameraPos.current.copy(camera.position);

        setLoading(false);
        onSceneLoaded?.(gltf);
      },
      undefined,
      () => {
        setLoading(false);
        setError(true);
      },
    );

    // double-click to reset
    const handleDblClick = () => resetCamera();
    renderer.domElement.addEventListener("dblclick", handleDblClick);

    // render loop
    function animate() {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // resize observer
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height: h } = entry.contentRect;
      if (width === 0 || h === 0) return;
      camera.aspect = width / h;
      camera.updateProjectionMatrix();
      renderer.setSize(width, h);
    });
    observer.observe(container);
    observerRef.current = observer;

    return () => {
      cancelAnimationFrame(frameRef.current);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      observer.disconnect();
      renderer.domElement.removeEventListener("dblclick", handleDblClick);
      disposeScene(scene);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [containerRef, modelUrl, autoRotate, backgroundColor, resetCamera, onSceneLoaded]);

  return { loading, error, resetCamera };
}
