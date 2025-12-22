
import React, { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useFrame, extend, ThreeElement, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Stars,
  ContactShadows,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";

/**
 * CRITICAL: Resolve "Multiple instances of Three.js"
 */
if (typeof window !== "undefined") {
  (window as any).THREE = THREE;
}

/* ================= Configuration ================= */

const USER_PROVIDED_PHOTOS = [
  "https://img.heliar.top/file/1766344105890_IMG_2593.jpeg",
  "https://img.heliar.top/file/1766381635443_image1.jpg",
  "https://img.heliar.top/file/1766381655841_image5.jpg",
  "https://img.heliar.top/file/1766381684552_image8.JPG",
  "https://img.heliar.top/file/1766381668947_image9.jpg",
  "https://img.heliar.top/file/1766381738623_image7.JPG",
  "https://img.heliar.top/file/1766381767812_10.JPG",
  "https://img.heliar.top/file/1766381809450_image2.jpg",
];

const BACKUP_PHOTOS = [
  "https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=600&q=80",
  "https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=600&q=80",
];

const BACKGROUND_MUSIC_URL = "https://cs1.mp3.pm/download/139557278/TGlCay9pSE9kbG04WjdwMDJNbnFsNGx5aEt0aFhnVllEby9jaTVGcXk1T1JrWU5XVnM1QUNzeUI4NlJJazIrU1QwREFPc0tRS2ZrL3BCSVJnU1Y3SFBHaVNGNnNmVHIvYmVYNk93N1ExdHoxc0FrZUJUV25TOXRjS05ETWdWbVc/back_number_-_full_(mp3.pm).mp3"; 

const PALETTE = {
  bg: "#02120b",
  emerald: "#0d3d2e",
  greenLight: "#4add8c",
  gold: "#ffcf4d",
  goldLight: "#fff0c0",
  pinkDeep: "#d66ba0",
};

/* ================= Utils ================= */

const damp = (c: number, t: number, l: number, d: number) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * d));

const getRandomSpherePoint = (r: number) => {
  const theta = Math.random() * Math.PI * 2;
  const v = Math.random();
  const phi = Math.acos(2 * v - 1);
  const rad = Math.cbrt(Math.random()) * r;
  return new THREE.Vector3(rad * Math.sin(phi) * Math.cos(theta), rad * Math.sin(phi) * Math.sin(theta), rad * Math.cos(phi));
};

const getRandomConePoint = (h: number, r: number) => {
  const hRaw = 1 - Math.cbrt(Math.random()); 
  const y = hRaw * h;
  const rad = r * (1 - y / h);
  const theta = Math.random() * Math.PI * 2;
  const dist = Math.sqrt(Math.random()) * rad;
  return new THREE.Vector3(dist * Math.cos(theta), y - h / 2, dist * Math.sin(theta));
};

const getConeSurfacePoint = (h: number, r: number) => {
  const y = Math.random() * h;
  const rad = r * (1 - y / h);
  const theta = Math.random() * Math.PI * 2;
  return new THREE.Vector3(rad * Math.cos(theta), y - h / 2, rad * Math.sin(theta));
};

/* ================= Custom Materials ================= */

const FoliageMaterial = shaderMaterial(
  {
    uTime: 0,
    uMix: 0,
    uColorBottom: new THREE.Color(PALETTE.emerald),
    uColorTop: new THREE.Color(PALETTE.greenLight),
    uColorGold: new THREE.Color(PALETTE.goldLight),
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
    varying float vRandom;

    void main() {
      vRandom = aRandom;
      vec3 pos = mix(aScatterPos, aTreePos, uMix);
      float flow = uTime * (0.1 + aRandom * 0.1);
      pos.x += cos(flow + pos.y * 1.0) * 0.05 * uMix;
      pos.z += sin(flow + pos.y * 1.0) * 0.05 * uMix;
      pos.y += sin(uTime * 0.6 + aRandom * 10.0) * 0.03;
      
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      // Reduce point size significantly to avoid "light ball" effect
      float sizeBase = mix(9.0, 5.5, uMix); 
      float size = (sizeBase + aRandom * 6.0) * uPixelRatio;
      size *= (32.0 / max(0.4, -mvPosition.z)); 
      gl_PointSize = clamp(size, 0.0, 50.0);

      float heightPct = (aTreePos.y + 6.0) / 12.0;
      float pulse = 0.85 + 0.15 * sin(uTime * 0.7 + aRandom * 12.0);
      vColor = mix(uColorBottom, uColorTop, heightPct) * pulse;
      
      // Smoother transition for alpha
      vAlpha = mix(0.7, 1.0, uMix) * (0.6 + 0.4 * sin(uTime * 0.5 + aRandom * 6.0));
    }
  `,
  `
    precision highp float;
    uniform float uTime;
    uniform vec3 uColorGold;
    varying vec3 vColor;
    varying float vAlpha;
    varying float vRandom;

    void main() {
      vec2 center = vec2(0.5, 0.5);
      float dist = length(gl_PointCoord - center);
      if (dist > 0.5) discard;

      // Refined Specular Shimmer (Sequin effect)
      // Highlight is smaller and sharper to avoid "glowing orb" look
      vec2 highlightPos = vec2(0.38, 0.38);
      float highlight = 1.0 - smoothstep(0.0, 0.15, length(gl_PointCoord - highlightPos));
      highlight = pow(highlight, 4.0); 

      // Added temporal glitter flickering for a more magical feel
      float glitter = step(0.96, fract(uTime * 1.2 + vRandom * 100.0));
      
      vec3 col = vColor;
      // Mix in gold specular and glitter sparkles
      col = mix(col, uColorGold, highlight * 0.9 + glitter * 0.4);

      // Sharp circle falloff
      float alpha = vAlpha * (1.0 - smoothstep(0.4, 0.5, dist));
      gl_FragColor = vec4(col, alpha);
    }
  `
);

const SignatureFloorMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(PALETTE.emerald), uGold: new THREE.Color(PALETTE.gold) },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec3 uGold;
    varying vec2 vUv;
    void main() {
      float dist = length(vUv - 0.5);
      float alpha = smoothstep(0.5, 0.1, dist);
      vec3 col = mix(vec3(0.0, 0.003, 0.001), uColor * 0.08, (1.0 - dist * 2.2));
      float shim = smoothstep(0.12, 0.0, abs(dist - 0.25)) * 0.035;
      col += uGold * shim * (0.6 + 0.4 * sin(uTime * 0.45));
      gl_FragColor = vec4(col, alpha * 0.75);
    }
  `
);

extend({ FoliageMaterial, SignatureFloorMaterial });

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        foliageMaterial: ThreeElement<typeof FoliageMaterial> & { uTime?: number; uMix?: number; uColorBottom?: THREE.Color; uColorTop?: THREE.Color; uColorGold?: THREE.Color; uPixelRatio?: number; };
        signatureFloorMaterial: ThreeElement<typeof SignatureFloorMaterial> & { uTime?: number; uColor?: THREE.Color; uGold?: THREE.Color; };
      }
    }
  }
}

/* ================= Custom Star Geometry ================= */

function createStarShape() {
  const shape = new THREE.Shape();
  const innerRadius = 0.4;
  const outerRadius = 1.0;
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/* ================= Components ================= */

const Snow = () => {
  const count = 300; 
  const mesh = useRef<THREE.Points>(null!);
  const [positions] = useState(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set([(Math.random() - 0.5) * 60, Math.random() * 50 - 10, (Math.random() - 0.5) * 60], i * 3);
    }
    return pos;
  });

  useFrame((state) => {
    const time = state.clock.elapsedTime * 0.1;
    const array = mesh.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      let y = array[i * 3 + 1];
      y -= 0.02;
      if (y < -15) y = 35;
      array[i * 3 + 1] = y;
      array[i * 3] += Math.sin(time + i) * 0.005;
    }
    mesh.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={positions} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color="white" transparent opacity={0.06} />
    </points>
  );
};

const MusicPlayer = () => {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(BACKGROUND_MUSIC_URL);
    audio.loop = true;
    audio.volume = 0.1;
    audioRef.current = audio;
    return () => { if (audioRef.current) audioRef.current.pause(); };
  }, []);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play().catch(console.error);
    setPlaying(!playing);
  };

  return (
    <div style={{ position: "fixed", top: "25px", right: "25px", zIndex: 1000, pointerEvents: "auto" }}>
      <button className="magic-button" onClick={toggle} style={{ padding: "10px 20px", fontSize: "0.7rem", minWidth: "130px" }}>
        {playing ? "🔊 MUSIC ON" : "🔈 MUSIC OFF"}
      </button>
    </div>
  );
};

const Foliage = ({ isTree }: { isTree: boolean }) => {
  const count = 4500; // Increased count slightly for density as size is smaller
  const materialRef = useRef<any>(null);
  const [data] = useState(() => {
    const sPos = new Float32Array(count * 3), tPos = new Float32Array(count * 3), rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const s = getRandomSpherePoint(26); s.y += 5;
      const t = getRandomConePoint(13, 4.6);
      sPos.set([s.x, s.y, s.z], i * 3);
      tPos.set([t.x, t.y, t.z], i * 3);
      rnd[i] = Math.random();
    }
    return { sPos, tPos, rnd };
  });

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = state.clock.elapsedTime;
      materialRef.current.uMix = damp(materialRef.current.uMix, isTree ? 1 : 0, 3, delta);
    }
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={data.tPos} />
        <bufferAttribute attach="attributes-aTreePos" count={count} itemSize={3} array={data.tPos} />
        <bufferAttribute attach="attributes-aScatterPos" count={count} itemSize={3} array={data.sPos} />
        <bufferAttribute attach="attributes-aRandom" count={count} itemSize={1} array={data.rnd} />
      </bufferGeometry>
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} uPixelRatio={window.devicePixelRatio} />
    </points>
  );
};

const GroundEffect = () => {
  const floorRef = useRef<any>(null);
  useFrame((state) => {
    if (floorRef.current) floorRef.current.uTime = state.clock.elapsedTime;
  });
  return (
    <group position={[0, -11.6, 0]}>
      <ContactShadows opacity={0.25} scale={24} blur={6} far={10} color="#000000" position={[0, 0.01, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[32, 32]} />
        <signatureFloorMaterial 
          ref={floorRef} 
          transparent 
          uColor={new THREE.Color(PALETTE.emerald)} 
          uGold={new THREE.Color(PALETTE.gold)} 
        />
      </mesh>
    </group>
  );
};

const Ornaments = ({ isTree }: { isTree: boolean }) => {
  const count = 75;
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 24, 24), []);
  const material = useMemo(() => new THREE.MeshPhysicalMaterial({ 
    roughness: 0.0, 
    metalness: 1.0, 
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    reflectivity: 1.0,
    envMapIntensity: 2.2,
    emissive: new THREE.Color("#111111"),
    emissiveIntensity: 0.9
  }), []);

  const data = useMemo(() => Array.from({ length: count }, () => ({
    tree: getConeSurfacePoint(12.2, 4.4).multiplyScalar(1.02),
    scatter: getRandomSpherePoint(26).add(new THREE.Vector3(0, 5, 0)),
    scale: 0.12 + Math.random() * 0.12,
    color: Math.random() > 0.5 ? PALETTE.gold : PALETTE.pinkDeep
  })), []);

  const mixVal = useRef(0);
  useFrame((state, delta) => {
    mixVal.current = damp(mixVal.current, isTree ? 1 : 0, 4, delta);
    data.forEach((d, i) => {
      dummy.position.lerpVectors(d.scatter, d.tree, mixVal.current);
      dummy.scale.setScalar(d.scale * (0.3 + 0.7 * mixVal.current));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    data.forEach((d, i) => {
      meshRef.current.setColorAt(i, new THREE.Color(d.color));
    });
    meshRef.current.instanceColor!.needsUpdate = true;
  }, [data]);

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} />;
};

const PhotoItem = ({ url, treePos, scatterPos, isTree, index, onSelect }: any) => {
  const group = useRef<THREE.Group>(null!);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspect, setAspect] = useState(1);
  const mix = useRef(0);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("Anonymous");
    loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      if (t.image) setAspect(t.image.width / t.image.height);
      setTexture(t);
    }, undefined, () => {
      loader.load(BACKUP_PHOTOS[index % BACKUP_PHOTOS.length], (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        setTexture(t);
      });
    });
  }, [url, index]);

  useFrame((state, delta) => {
    mix.current = damp(mix.current, isTree ? 1 : 0, 4, delta);
    group.current.position.lerpVectors(scatterPos, treePos, mix.current);
    if (isTree && mix.current > 0.8) {
      group.current.lookAt(0, group.current.position.y, 0);
      group.current.rotateY(Math.PI);
    } else {
      group.current.rotation.y = state.clock.elapsedTime * 0.08 + index;
    }
    group.current.scale.setScalar(isTree ? 0.55 : 1.1);
  });

  const h = 1.35;
  const w = h * aspect;

  return (
    <group ref={group} onClick={(e) => { e.stopPropagation(); onSelect(url); }}>
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[w + 0.1, h + 0.1, 0.05]} />
        <meshPhysicalMaterial color={PALETTE.gold} metalness={1.0} roughness={0.05} emissive={PALETTE.gold} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[w, h]} />
        {texture ? <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.98} /> : <meshBasicMaterial color="#111" />}
      </mesh>
    </group>
  );
};

const PhotoGallery = ({ isTree, onSelect }: any) => {
  const items = useMemo(() => USER_PROVIDED_PHOTOS.map((url, i) => {
    const y = (1 - i / USER_PROVIDED_PHOTOS.length) * 10 - 4.5;
    const r = 4.6 * (1 - (y + 5) / 12) + 0.6;
    const theta = i * 2.5;
    return {
      url,
      treePos: new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)),
      scatterPos: getRandomSpherePoint(28).add(new THREE.Vector3(0, 5, 0))
    };
  }), []);
  return <group>{items.map((p, i) => <PhotoItem key={i} index={i} isTree={isTree} {...p} onSelect={onSelect} />)}</group>;
};

const StarTop = ({ isTree }: { isTree: boolean }) => {
  const ref = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const shape = useMemo(() => createStarShape(), []);
  const extrudeSettings = useMemo(() => ({ depth: 0.22, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3 }), []);

  useFrame((state, delta) => {
    meshRef.current.rotation.y += delta * 2.0;
    const targetY = isTree ? 7.2 : 40;
    ref.current.position.y = damp(ref.current.position.y, targetY, 4, delta);
    ref.current.scale.setScalar(isTree ? 1.4 : 0.01);
  });

  return (
    <group ref={ref} position={[0, 15, 0]}>
      <mesh ref={meshRef}> 
        <extrudeGeometry args={[shape, extrudeSettings]} />
        <meshStandardMaterial color={PALETTE.gold} emissive={PALETTE.gold} emissiveIntensity={4.5} toneMapped={false} />
      </mesh>
      <pointLight color={PALETTE.gold} intensity={14} distance={22} />
    </group>
  );
};

const Scene = ({ isTree, onSelectPhoto }: any) => {
  const { size } = useThree();
  const isMobile = size.width < size.height;
  const fov = isMobile ? 65 : 45;
  const cameraDist = isMobile ? 38 : 30;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 4, cameraDist]} fov={fov} />
      <OrbitControls autoRotate autoRotateSpeed={0.2} enablePan={false} maxPolarAngle={Math.PI / 1.75} minDistance={12} maxDistance={75} />
      
      <Environment preset="night" />
      <ambientLight intensity={0.3} />
      <spotLight position={[20, 50, 20]} intensity={60} color={PALETTE.goldLight} angle={0.4} penumbra={1} castShadow />
      <pointLight position={[-15, 10, -15]} intensity={10} color={PALETTE.pinkDeep} />

      <Stars radius={150} depth={80} count={5000} factor={6} saturation={0} fade speed={1.5} />
      <Snow />

      <group position={[0, -2.5, 0]}>
        <Float speed={1.5} rotationIntensity={0.05} floatIntensity={0.1}>
          <Foliage isTree={isTree} />
          <Ornaments isTree={isTree} />
          <PhotoGallery isTree={isTree} onSelect={onSelectPhoto} />
          <StarTop isTree={isTree} />
        </Float>
      </group>
      
      <GroundEffect />

      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom luminanceThreshold={0.5} intensity={1.1} mipmapBlur radius={0.5} />
        <Vignette eskil={false} offset={0.1} darkness={0.8} />
        <Noise opacity={0.01} />
      </EffectComposer>
    </>
  );
};

/* ================= UI Components ================= */

const UIOverlay = ({ isTree, toggle }: any) => (
  <div className="ui-container">
    <div className="ui-header">
      <span className="subtitle">クリスマス</span>
      <h1>À toi</h1>
    </div>
    <div className="ui-footer">
      <button className="magic-button" onClick={toggle}>
        {isTree ? "Scatter Stars" : "CLICK"}
      </button>
      <div className="instruction">YUMANMOK</div>
    </div>
  </div>
);

const Lightbox = ({ src, close }: any) => {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={close}>
      <img src={src} alt="Memory" />
      <div style={{ position: "absolute", bottom: "40px", color: "white", opacity: 0.5, fontSize: "12px", letterSpacing: "3px" }}>
        TAP TO EXIT
      </div>
    </div>
  );
};

const App = () => {
  const [isTree, setIsTree] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ width: "100vw", height: "100vh", background: PALETTE.bg }}>
      <UIOverlay isTree={isTree} toggle={() => setIsTree(!isTree)} />
      <MusicPlayer />
      <Lightbox src={selected} close={() => setSelected(null)} />
      <Canvas 
        shadows 
        dpr={window.innerWidth < 768 ? 1 : [1, 2]} 
        gl={{ 
          antialias: false, 
          toneMapping: THREE.ACESFilmicToneMapping,
          powerPreference: "high-performance"
        }}
      >
        <Suspense fallback={null}>
          <Scene isTree={isTree} onSelectPhoto={setSelected} />
        </Suspense>
      </Canvas>
      <style>{`
        .lightbox {
          position: fixed; top:0; left:0; width:100%; height:100%;
          background: rgba(0,0,0,0.97); z-index: 2000;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          cursor: pointer; backdrop-filter: blur(30px);
          animation: fadeIn 0.4s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .lightbox img { 
          max-width: 92%; max-height: 85%; 
          border: 1px solid rgba(255, 207, 77, 0.3); 
          box-shadow: 0 0 100px rgba(0, 0, 0, 0.9);
        }
      `}</style>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
