
import React, { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  useTexture,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";

// --- Configuration ---

// 📸 [照片配置]
// Replace with highly reliable Unsplash IDs to prevent 403/404 errors
const BASE_PHOTOS = [
  "https://yuman-pf-images.oss-cn-guangzhou.aliyuncs.com/xmas/images/image1.jpg", // Red ornaments
  "https://yuman-pf-images.oss-cn-guangzhou.aliyuncs.com/xmas/images/image10.JPG", // Green/Gold bokeh
  "https://yuman-pf-images.oss-cn-guangzhou.aliyuncs.com/xmas/images/image8.JPG", // Green/Gold bokeh
  "https://yuman-pf-images.oss-cn-guangzhou.aliyuncs.com/xmas/images/image2.jpg", // Sparkles
  "https://yuman-pf-images.oss-cn-guangzhou.aliyuncs.com/xmas/images/image6.JPG"  // Christmas tree and gifts
];

// 自动生成 10 张照片的数组
const USER_PHOTOS = BASE_PHOTOS.length > 0 
  ? Array.from({ length: 10 }, (_, i) => BASE_PHOTOS[i % BASE_PHOTOS.length])
  : [];

// 🎵 [背景音乐]
const BACKGROUND_MUSIC_URL = "https://er-sycdn.kuwo.cn/75e6ee7b5bd2e852d0307ac2a57cd8d2/693ec86f/resource/30106/trackmedia/M500000jZ9Vr2Wgbeu.mp3";

// --- Constants & Palette (Emerald + Gold Theme) ---
const PALETTE = {
  bg: "#02120b",
  primary: "#e8d4e8",
  emerald: "#1a5e4a", // Significantly brighter emerald for better visibility
  greenDark: "#1a4731",
  greenLight: "#4add8c", 
  gold: "#ffcf4d",
  goldLight: "#fff0c0",
  pink: "#ffb7c5",
  pinkDeep: "#d66ba0",
  redVelvet: "#c41e3a",
};

// --- Damp helper ---
function damp(current: number, target: number, lambda: number, delta: number) {
  const t = 1 - Math.exp(-lambda * delta);
  return THREE.MathUtils.lerp(current, target, t);
}

function dampVec3(out: THREE.Vector3, current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number) {
  const t = 1 - Math.exp(-lambda * delta);
  out.lerpVectors(current, target, t);
}

// --- Custom Shaders ---

const FoliageMaterial = shaderMaterial(
  {
    uTime: 0,
    uMix: 0,
    uColorBottom: new THREE.Color(PALETTE.emerald),
    uColorTop: new THREE.Color(PALETTE.greenLight),
    uPixelRatio: 1,
  },
  `
    precision highp float;
    uniform float uTime;
    uniform float uMix;
    uniform float uPixelRatio;
    uniform vec3 uColorBottom;
    uniform vec3 uColorTop;
    attribute vec3 aScatterPos;
    attribute vec3 aTreePos;
    attribute float aRandom;
    varying vec3 vColor;
    varying float vAlpha;

    float cubicInOut(float t) {
      return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
    }

    void main() {
      float t = cubicInOut(uMix);
      vec3 pos = mix(aScatterPos, aTreePos, t);
      
      // Breathing & Wind
      float breathe = sin(uTime * 1.5 + aRandom * 10.0) * 0.08 * t;
      pos.y += breathe;
      pos.x += cos(uTime * 0.5 + pos.y) * 0.03 * t;
      
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      // Size attenuation
      float baseSize = (7.0 + aRandom * 5.0) * uPixelRatio; // Slightly larger particles
      baseSize *= (12.0 / max(0.5, -mvPosition.z)); 
      gl_PointSize = clamp(baseSize, 0.0, 90.0);

      // Color Gradient
      // Ensure we use the full range of colors
      float heightPct = (aTreePos.y + 6.0) / 12.0;
      vec3 treeColor = mix(uColorBottom, uColorTop, heightPct + sin(uTime + aRandom) * 0.1); 
      
      // Flash effect (golden sparkles)
      float flash = step(0.98, sin(uTime * 3.0 + aRandom * 100.0));
      treeColor = mix(treeColor, vec3(1.0, 0.95, 0.6), flash * 0.5 * t);

      vColor = treeColor;
      vAlpha = 0.9 + 0.1 * t; 
    }
  `,
  `
    precision highp float;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec2 center = gl_PointCoord - 0.5;
      float dist = length(center);
      if (dist > 0.5) discard;
      
      // Harder core, softer edge
      float strength = 1.0 - smoothstep(0.35, 0.5, dist);
      
      // Explicitly output color
      gl_FragColor = vec4(vColor, vAlpha * strength);
      
      // Colorspace fix: If the environment is very linear, manually boost gamma? 
      // R3F handles this usually, but let's just ensure we output strong alpha.
    }
  `
);

extend({ FoliageMaterial });

declare global {
  namespace JSX {
    interface IntrinsicElements {
      foliageMaterial: any;
      [elemName: string]: any;
    }
  }
}

// --- Utils ---

const getRandomSpherePoint = (r: number) => {
  const theta = Math.random() * Math.PI * 2;
  const v = Math.random();
  const phi = Math.acos(2 * v - 1);
  const rad = Math.cbrt(Math.random()) * r;
  return new THREE.Vector3(
    rad * Math.sin(phi) * Math.cos(theta),
    rad * Math.sin(phi) * Math.sin(theta),
    rad * Math.cos(phi)
  );
};

const getRandomConePoint = (height: number, maxRadius: number) => {
  const hRaw = 1 - Math.cbrt(Math.random()); 
  const y = hRaw * height;
  const rAtHeight = maxRadius * (1 - y / height);
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * rAtHeight;
  const x = r * Math.cos(theta);
  const z = r * Math.sin(theta);
  return new THREE.Vector3(x, y - height / 2, z);
};

const getConeSurfacePoint = (height: number, maxRadius: number) => {
  const y = Math.random() * height;
  const rAtHeight = maxRadius * (1 - y / height);
  const theta = Math.random() * Math.PI * 2;
  const x = rAtHeight * Math.cos(theta);
  const z = rAtHeight * Math.sin(theta);
  return new THREE.Vector3(x, y - height / 2, z);
};

// --- UI Components ---

const LoadingScreen = () => (
  <div className="loader-container">
    <div className="loader"></div>
    <div className="loader-text">Loading Memories...</div>
  </div>
);

const UIOverlay = ({ toggleTree }: { toggleTree: () => void }) => (
  <div className="ui-container">
    <div className="ui-header">
      <span className="subtitle">ARIX Signature</span>
      <h1>À toi</h1>
    </div>
    <div className="ui-footer">
      <button className="magic-button" onClick={toggleTree}>
        Scatter / Assemble
      </button>
      <div className="instruction">Drag to Rotate • Scroll to Zoom</div>
    </div>
  </div>
);

const MusicPlayer = () => {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (BACKGROUND_MUSIC_URL) {
      const audio = new Audio(BACKGROUND_MUSIC_URL);
      audio.loop = true;
      audio.volume = 0.5;
      audioRef.current = audio;
    }
    return () => {
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play().catch(console.warn);
    setPlaying(!playing);
  };

  if (!BACKGROUND_MUSIC_URL) return null;

  return (
    <div style={{ position: "absolute", top: 20, right: 20, zIndex: 1000 }}>
      <button onClick={toggle} className="magic-button" style={{ padding: "8px 20px", fontSize: "0.6rem" }}>
        {playing ? "🎵 ON" : "🔇 OFF"}
      </button>
    </div>
  );
};

const Lightbox = ({ src, onClose }: { src: string | null; onClose: () => void }) => {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0, left: 0, width: "100vw", height: "100vh",
        backgroundColor: "rgba(13, 10, 18, 0.95)",
        backdropFilter: "blur(20px)",
        zIndex: 2000,
        display: "flex", justifyContent: "center", alignItems: "center",
        cursor: "zoom-out",
      }}
    >
      <img
        src={src}
        alt="Memory"
        style={{
          maxWidth: "85vw", maxHeight: "85vh",
          objectFit: "contain",
          border: "1px solid #e5c15d",
          boxShadow: "0 0 50px rgba(229, 193, 93, 0.3)",
          borderRadius: "4px",
        }}
      />
    </div>
  );
};

// --- 3D Components ---

const Foliage = ({ isTree }: { isTree: boolean }) => {
  const count = 3500;
  const meshRef = useRef<THREE.Points | null>(null);
  const materialRef = useRef<any>(null);

  const [data] = useState(() => {
    const scatterPos = new Float32Array(count * 3);
    const treePos = new Float32Array(count * 3);
    const randoms = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const s = getRandomSpherePoint(16);
      s.y += 5;
      scatterPos[i * 3] = s.x;
      scatterPos[i * 3 + 1] = s.y;
      scatterPos[i * 3 + 2] = s.z;

      const t = getRandomConePoint(12.5, 4.0);
      treePos[i * 3] = t.x;
      treePos[i * 3 + 1] = t.y;
      treePos[i * 3 + 2] = t.z;

      randoms[i] = Math.random();
    }
    return { scatterPos, treePos, randoms };
  });

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      const cur = materialRef.current.uniforms.uMix.value;
      const target = isTree ? 1 : 0;
      materialRef.current.uniforms.uMix.value = damp(cur, target, isTree ? 4.0 : 2.5, delta);
    }
  });

  return (
    <points ref={meshRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={data.treePos} />
        <bufferAttribute attach="attributes-aTreePos" count={count} itemSize={3} array={data.treePos} />
        <bufferAttribute attach="attributes-aScatterPos" count={count} itemSize={3} array={data.scatterPos} />
        <bufferAttribute attach="attributes-aRandom" count={count} itemSize={1} array={data.randoms} />
      </bufferGeometry>
      {/* @ts-ignore foliageMaterial from extend */}
      <foliageMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        // Force NormalBlending to fix grey/washed-out artifacts
        blending={THREE.NormalBlending} 
        uColorBottom={new THREE.Color(PALETTE.emerald)}
        uColorTop={new THREE.Color(PALETTE.greenLight)}
        uPixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
        toneMapped={false} 
      />
    </points>
  );
};

const Ornaments = ({ isTree }: { isTree: boolean }) => {
  const count = 150;
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        roughness: 0.15,
        metalness: 0.8, // Reduced metalness to avoid dark renders in low light
        clearcoat: 1.0,
        color: 0xffffff,
        vertexColors: true,
      }),
    []
  );

  const instances = useMemo(() => {
    const data: { tree: THREE.Vector3; scatter: THREE.Vector3; scale: number; color: string }[] = [];
    for (let i = 0; i < count; i++) {
      const surface = getConeSurfacePoint(11.5, 3.8);
      surface.x *= 1.05;
      surface.z *= 1.05;

      const scatter = getRandomSpherePoint(18);
      scatter.y += 5;

      const scale = 0.12 + Math.random() * 0.18;
      const color = Math.random() > 0.4 ? PALETTE.gold : PALETTE.pink;
      data.push({ tree: surface, scatter, scale, color });
    }
    return data;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mixRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, isTree ? 6.0 : 3.0, delta);
    const t = mixRef.current;

    instances.forEach((data, i) => {
      dummy.position.lerpVectors(data.scatter, data.tree, t);
      const time = state.clock.elapsedTime;
      const wave = Math.sin(time * 0.5 + i) * 0.2 * (1 - t);
      dummy.position.y += wave;
      dummy.rotation.x = time * 0.2 + i;
      dummy.rotation.y = time * 0.15 + i * 0.1;
      dummy.scale.setScalar(data.scale * (0.5 + 0.5 * t));
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    if (meshRef.current) {
      const color = new THREE.Color();
      instances.forEach((data, i) => {
        meshRef.current!.setColorAt(i, color.set(data.color));
      });
      if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [instances]);

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />;
};

const Diamonds = ({ isTree }: { isTree: boolean }) => {
  const count = 40;
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const geometry = useMemo(() => new THREE.OctahedronGeometry(1, 0), []);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0.1,
        roughness: 0.0,
        transmission: 0.6,
        thickness: 1.5,
        clearcoat: 1.0,
        ior: 1.5,
      }),
    []
  );

  const instances = useMemo(() => {
    const data: { tree: THREE.Vector3; scatter: THREE.Vector3 }[] = [];
    for (let i = 0; i < count; i++) {
      const h = 3 + Math.random() * 6;
      const maxR = 4.5 * (1 - h / 12);
      const theta = Math.random() * Math.PI * 2;
      const treePos = new THREE.Vector3(maxR * Math.cos(theta), h - 6, maxR * Math.sin(theta)).multiplyScalar(1.15);
      const scatter = getRandomSpherePoint(18);
      scatter.y += 5;
      data.push({ tree: treePos, scatter });
    }
    return data;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mixRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, isTree ? 5.0 : 3.0, delta);
    const t = mixRef.current;
    instances.forEach((data, i) => {
      dummy.position.lerpVectors(data.scatter, data.tree, t);
      const time = state.clock.elapsedTime;
      dummy.rotation.set(time + i, time * 1.5 + i, 0);
      dummy.scale.setScalar(0.15 * t);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />;
};

const Gifts = ({ isTree }: { isTree: boolean }) => {
  const count = 20;
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = PALETTE.redVelvet;
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(54, 0, 20, 128);
      ctx.fillRect(0, 54, 128, 20);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.4 }), [texture]);

  const instances = useMemo(() => {
    const data: { tree: THREE.Vector3; scatter: THREE.Vector3; scale: number }[] = [];
    for (let i = 0; i < count; i++) {
      const r = 1.5 + Math.random() * 3.0;
      const theta = Math.random() * Math.PI * 2;
      const treePos = new THREE.Vector3(r * Math.cos(theta), -5.5 + Math.random() * 0.5, r * Math.sin(theta));
      const scatter = getRandomSpherePoint(18);
      scatter.y += 5;
      const scale = 0.2 + Math.random() * 0.2;
      data.push({ tree: treePos, scatter, scale });
    }
    return data;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mixRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, isTree ? 5.0 : 3.0, delta);
    const t = mixRef.current;

    instances.forEach((data, i) => {
      dummy.position.lerpVectors(data.scatter, data.tree, t);
      dummy.rotation.y = state.clock.elapsedTime * 0.1 + i;
      dummy.scale.setScalar(data.scale * t);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />;
};

const PhotoFrame = ({ texture, treePos, scatterPos, isTree, index, url, onSelect }: any) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const mixRef = useRef(0);

  const width = (texture && texture.image && texture.image.width) || 1;
  const height = (texture && texture.image && texture.image.height) || 1;
  const aspect = width / height;

  const baseH = 1.0;
  const planeW = baseH * aspect;
  const planeH = baseH;
  const frameW = planeW + 0.15;
  const frameH = planeH + 0.15;

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, isTree ? 6.0 : 3.0, delta);
    const t = mixRef.current;
    const targetPos = new THREE.Vector3().lerpVectors(scatterPos, treePos, t);
    groupRef.current.position.copy(targetPos);

    if (isTree && t > 0.8) {
      groupRef.current.lookAt(0, groupRef.current.position.y, 0);
      groupRef.current.rotateY(Math.PI);
    } else {
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2 + index) * 0.5;
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.1 + index;
      groupRef.current.rotation.z = Math.cos(state.clock.elapsedTime * 0.15 + index) * 0.3;
    }
    const scale = isTree ? 0.65 : 0.8 + Math.sin(state.clock.elapsedTime + index) * 0.1;
    groupRef.current.scale.setScalar(scale);
  });

  return (
    <group
      ref={groupRef}
      onClick={(e) => { e.stopPropagation(); onSelect(url); }}
      onPointerOver={() => { document.body.style.cursor = "zoom-in"; }}
      onPointerOut={() => { document.body.style.cursor = "default"; }}
    >
      <mesh position={[0, 0, -0.01]}>
        <boxGeometry args={[frameW, frameH, 0.05]} />
        <meshPhysicalMaterial color={PALETTE.gold} metalness={0.95} roughness={0.1} clearcoat={1} />
      </mesh>
      <mesh>
        <planeGeometry args={[planeW, planeH]} />
        <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[planeW, planeH]} />
        <meshStandardMaterial color={PALETTE.gold} roughness={0.5} />
      </mesh>
    </group>
  );
};

const PhotoGallery = ({ isTree, photos, onSelectPhoto }: { isTree: boolean; photos: string[]; onSelectPhoto: (url: string) => void }) => {
  // If photos is empty or undefined, render nothing
  if (!photos || photos.length === 0) return null;

  // useTexture is suspense-driven. If it fails, it throws a promise or error.
  // The boundary above catches errors. 
  // We use reliable URLs now, but let's handle the array gracefully.
  const textures = useTexture(photos);
  
  // useTexture returns an array if input is array, but let's be safe
  const textureArray = Array.isArray(textures) ? textures : [textures];

  const items = useMemo(() => {
    return textureArray.map((texture, i) => {
      const count = textureArray.length;
      const height = 10;
      const pct = i / Math.max(1, count - 1);
      const y = (1 - pct) * height - height / 2 + 1;
      const r = 4.0 * (1 - (y + 6) / 12.5);
      const theta = i * Math.PI * (3 - Math.sqrt(5)) * 10 + Math.PI / 4;

      const treePos = new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)).multiplyScalar(1.2);
      const scatterPos = getRandomSpherePoint(20);
      scatterPos.y += 5;

      return { texture, treePos, scatterPos, url: photos[i] };
    });
  }, [textureArray, photos]);

  return (
    <group>
      {items.map((item, i) => (
        <PhotoFrame
          key={i}
          index={i}
          isTree={isTree}
          texture={item.texture}
          treePos={item.treePos}
          scatterPos={item.scatterPos}
          url={item.url}
          onSelect={onSelectPhoto}
        />
      ))}
    </group>
  );
};

const FairyLights = ({ isTree }: { isTree: boolean }) => {
  const count = 400;
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 8, 8), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(PALETTE.goldLight),
        emissiveIntensity: 10,
        toneMapped: false,
      }),
    []
  );

  const instances = useMemo(() => {
    const data: { tree: THREE.Vector3; scatter: THREE.Vector3 }[] = [];
    const turns = 10;
    const height = 12;
    const maxR = 4.6;
    for (let i = 0; i < count; i++) {
      const pct = i / count;
      const y = pct * height - height / 2;
      const r = maxR * (1 - pct);
      const theta = pct * turns * Math.PI * 2;
      const treePos = new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)).multiplyScalar(1.02);
      const scatterPos = getRandomSpherePoint(12);
      scatterPos.y += 5;
      data.push({ tree: treePos, scatter: scatterPos });
    }
    return data;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const mixRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, isTree ? 6.0 : 3.0, delta);
    const t = mixRef.current;
    const time = state.clock.elapsedTime;
    instances.forEach((data, i) => {
      dummy.position.lerpVectors(data.scatter, data.tree, t);
      const twinkle = Math.sin(time * 3 + i * 0.5) * 0.5 + 0.5;
      const scale = 0.08 * (0.5 + 0.5 * t) + 0.04 * twinkle * t;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />;
};

const Star = ({ isTree }: { isTree: boolean }) => {
  const ref = useRef<THREE.Group | null>(null);
  const scatterPos = useMemo(() => new THREE.Vector3(0, 10, 0), []);

  useFrame((state, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.8;
      ref.current.rotation.z = Math.sin(state.clock.elapsedTime) * 0.1;
      const target = isTree ? new THREE.Vector3(0, 6.2, 0) : scatterPos;
      const curPos = ref.current.position.clone();
      dampVec3(ref.current.position, curPos, target, isTree ? 8.0 : 3.0, delta);
      const s = isTree ? 1 : 0.1;
      const newScale = THREE.MathUtils.lerp(ref.current.scale.x || 1, s, 1 - Math.exp(-6 * delta));
      ref.current.scale.setScalar(newScale);
    }
  });

  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshBasicMaterial color={PALETTE.gold} toneMapped={false} />
      </mesh>
      <pointLight color={PALETTE.gold} intensity={3} distance={10} decay={2} />
    </group>
  );
};

const BackgroundParticles = () => {
  const count = 500;
  const meshRef = useRef<THREE.Points | null>(null);
  const [positions] = useState(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = getRandomSpherePoint(30);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
    }
    return pos;
  });

  useFrame((state, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.02;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={positions} />
      </bufferGeometry>
      <pointsMaterial size={0.15} color={PALETTE.pink} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
};

class TextureErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any) {
    console.warn("Failed to load textures. PhotoGallery disabled.", error);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const Scene = ({ isTree, toggleTree, customPhotos, onSelectPhoto }: { isTree: boolean; toggleTree: () => void; customPhotos: string[]; onSelectPhoto: (url: string) => void }) => {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 4, 18]} fov={50} />
      <OrbitControls
        target={[0, 2, 0]}
        enablePan={false}
        maxPolarAngle={Math.PI / 2 - 0.1}
        minDistance={8}
        maxDistance={30}
        autoRotate={isTree}
        autoRotateSpeed={0.5}
      />

      <Environment preset="city" background={false} blur={0.8} />

      <ambientLight intensity={0.4} color={PALETTE.emerald} />
      <spotLight position={[10, 20, 10]} intensity={8} angle={0.6} penumbra={1} color={PALETTE.goldLight} castShadow shadow-bias={-0.0001} />
      <pointLight position={[-10, 5, -10]} intensity={4} color={PALETTE.pinkDeep} />
      <spotLight position={[0, 10, -15]} intensity={6} color="#cceeff" angle={1} />

      <group position={[0, -2, 0]}>
        <Float speed={isTree ? 2 : 0.5} rotationIntensity={isTree ? 0.2 : 0.05} floatIntensity={isTree ? 0.5 : 0.1}>
          <Foliage isTree={isTree} />
          <Ornaments isTree={isTree} />
          <Diamonds isTree={isTree} />
          <Gifts isTree={isTree} />
          <TextureErrorBoundary>
            <Suspense fallback={null}>
              <PhotoGallery isTree={isTree} photos={customPhotos} onSelectPhoto={onSelectPhoto} />
            </Suspense>
          </TextureErrorBoundary>
          <FairyLights isTree={isTree} />
          <Star isTree={isTree} />
        </Float>
      </group>

      <BackgroundParticles />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -6, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color={PALETTE.emerald} roughness={0.2} metalness={0.6} />
      </mesh>

      <EffectComposer enableNormalPass={false}>
        <Bloom luminanceThreshold={0.8} mipmapBlur intensity={1.0} radius={0.5} />
        <Noise opacity={0.05} />
        <Vignette offset={0.3} darkness={0.7} />
      </EffectComposer>
    </>
  );
};

const App = () => {
  const [isTree, setIsTree] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  return (
    <>
      <UIOverlay toggleTree={() => setIsTree((s) => !s)} />
      <MusicPlayer />
      <Lightbox src={selectedPhoto} onClose={() => setSelectedPhoto(null)} />

      <Canvas shadows dpr={[1, 2]} gl={{ antialias: false, toneMapping: THREE.CineonToneMapping, toneMappingExposure: 1.2 }}>
        <Suspense fallback={null}>
          <Scene isTree={isTree} toggleTree={() => setIsTree((s) => !s)} customPhotos={USER_PHOTOS} onSelectPhoto={setSelectedPhoto} />
        </Suspense>
      </Canvas>

      <Suspense fallback={<LoadingScreen />}>
        <group />
      </Suspense>
    </>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<App />);
} else {
  console.error("Root element #root not found");
}
