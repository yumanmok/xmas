
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
  Text,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";

// --- Configuration ---

// 📸 [照片配置] - 使用你提供的新图床
const USER_PROVIDED_PHOTOS = [
  "https://img.heliar.top/file/1766344105890_IMG_2593.jpeg",
  "https://img.heliar.top/file/1766381635443_image1.jpg",
  "https://img.heliar.top/file/1766381655841_image5.jpg",
  "https://img.heliar.top/file/1766381684552_image8.JPG",
  "https://img.heliar.top/file/1766381668947_image9.jpg",
  "https://img.heliar.top/file/1766381738623_image7.JPG",
  "https://img.heliar.top/file/1766381767812_10.JPG",
  "https://img.heliar.top/file/1766381809450_image2.jpg"
];

// 备用图源
const BACKUP_PHOTOS = [
  "https://images.unsplash.com/photo-1544967082-d9d25d867d66?ixlib=rb-4.0.3&w=600&q=80",
  "https://images.unsplash.com/photo-1512389142860-9c449e58a543?ixlib=rb-4.0.3&w=600&q=80"
];

// 🎵 [背景音乐]
const BACKGROUND_MUSIC_URL = "https://er-sycdn.kuwo.cn/b61562cab0531a37fb3514b5303dfaf0/6948d9da/resource/30106/trackmedia/M500000jZ9Vr2Wgbeu.mp3";

const PALETTE = {
  bg: "#02120b",
  primary: "#e8d4e8",
  emerald: "#0d3d2e",
  greenLight: "#4add8c", 
  gold: "#ffcf4d",
  goldLight: "#fff0c0",
  pink: "#ffb7c5",
  pinkDeep: "#d66ba0",
  redVelvet: "#c41e3a",
};

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

    void main() {
      float t = uMix;
      vec3 pos = mix(aScatterPos, aTreePos, t);
      
      // 🌀 持续粒子流动逻辑 (Flow Effect)
      float angle = uTime * (0.2 + aRandom * 0.3);
      float dist = length(pos.xz) + 0.01;
      // 在树形态下加入环绕流动
      if(t > 0.5) {
        pos.x += cos(angle + pos.y) * 0.15;
        pos.z += sin(angle + pos.y) * 0.15;
        pos.y += sin(uTime + aRandom * 10.0) * 0.1;
      }
      
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      float baseSize = (8.0 + aRandom * 6.0) * uPixelRatio;
      baseSize *= (15.0 / max(0.5, -mvPosition.z)); 
      gl_PointSize = clamp(baseSize, 0.0, 100.0);

      float heightPct = (aTreePos.y + 6.0) / 12.0;
      vec3 treeColor = mix(uColorBottom, uColorTop, heightPct + sin(uTime * 0.5 + aRandom) * 0.2); 
      
      // 闪烁特效
      float flash = step(0.97, sin(uTime * 2.0 + aRandom * 100.0));
      vColor = mix(treeColor, vec3(1.0, 0.9, 0.5), flash * 0.6);
      vAlpha = 0.8 + 0.2 * t; 
    }
  `,
  `
    precision highp float;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      float dist = length(gl_PointCoord - 0.5);
      if (dist > 0.5) discard;
      float strength = 1.0 - smoothstep(0.2, 0.5, dist);
      gl_FragColor = vec4(vColor, vAlpha * strength);
    }
  `
);

extend({ FoliageMaterial });

// --- Utils ---
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

// --- Components ---

const Foliage = ({ isTree }: { isTree: boolean }) => {
  const count = 4000;
  const materialRef = useRef<any>(null);
  const [data] = useState(() => {
    const sPos = new Float32Array(count * 3), tPos = new Float32Array(count * 3), rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const s = getRandomSpherePoint(18); s.y += 5;
      const t = getRandomConePoint(13, 4.5);
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
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} uPixelRatio={window.devicePixelRatio} />
    </points>
  );
};

const Ornaments = ({ isTree }: { isTree: boolean }) => {
  const count = 120;
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.SphereGeometry(1, 16, 16), []);
  // 核心：调整材质以防变黑
  const material = useMemo(() => new THREE.MeshStandardMaterial({ 
    roughness: 0.1, 
    metalness: 0.4, 
    emissive: new THREE.Color("#222"), // 加入微弱自发光防止死黑
    emissiveIntensity: 0.5
  }), []);

  const instances = useMemo(() => {
    return Array.from({ length: count }, () => ({
      tree: getConeSurfacePoint(12, 4.2).multiplyScalar(1.05),
      scatter: getRandomSpherePoint(20).add(new THREE.Vector3(0, 5, 0)),
      scale: 0.15 + Math.random() * 0.15,
      color: Math.random() > 0.5 ? PALETTE.gold : PALETTE.pinkDeep
    }));
  }, []);

  const mixRef = useRef(0);
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, 4, delta);
    instances.forEach((data, i) => {
      dummy.position.lerpVectors(data.scatter, data.tree, mixRef.current);
      dummy.scale.setScalar(data.scale * (0.3 + 0.7 * mixRef.current));
      dummy.rotation.y += delta * (i % 2 === 0 ? 1 : -1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    if (meshRef.current) {
      instances.forEach((data, i) => meshRef.current!.setColorAt(i, new THREE.Color(data.color)));
      meshRef.current.instanceColor!.needsUpdate = true;
    }
  }, []);

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} />;
};

const PhotoFrame = ({ texture, treePos, scatterPos, isTree, index, url, onSelect, error }: any) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const mixRef = useRef(0);

  const aspect = (texture?.image?.width / texture?.image?.height) || 1;
  const planeW = 1.2 * aspect, planeH = 1.2;

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    mixRef.current = damp(mixRef.current, isTree ? 1 : 0, 4, delta);
    const t = mixRef.current;
    groupRef.current.position.lerpVectors(scatterPos, treePos, t);
    
    if (isTree && t > 0.8) {
      groupRef.current.lookAt(0, groupRef.current.position.y, 0);
      groupRef.current.rotateY(Math.PI);
    } else {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.5 + index;
    }
    groupRef.current.scale.setScalar(isTree ? 0.7 : 1.0);
  });

  return (
    <group ref={groupRef} onClick={(e) => { e.stopPropagation(); onSelect(url); }}>
      <mesh position={[0, 0, -0.02]}>
        <boxGeometry args={[planeW + 0.1, planeH + 0.1, 0.05]} />
        <meshStandardMaterial color={PALETTE.gold} metalness={0.7} roughness={0.2} emissive={PALETTE.gold} emissiveIntensity={0.2} />
      </mesh>
      <mesh>
        <planeGeometry args={[planeW, planeH]} />
        {error ? <meshBasicMaterial color="#300" /> : <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.95} />}
      </mesh>
      {error && <Text position={[0, 0, 0.05]} fontSize={0.1} color="white">LOAD ERROR</Text>}
    </group>
  );
};

const PhotoItem = ({ url, treePos, scatterPos, isTree, index, onSelect }: any) => {
  // 单张图片独立加载逻辑，防止一张报错全部崩溃
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => setTexture(tex),
      undefined,
      () => {
        // 如果用户图床失败，自动尝试备用图
        const backup = BACKUP_PHOTOS[index % BACKUP_PHOTOS.length];
        loader.load(backup, (bTex) => setTexture(bTex), undefined, () => setError(true));
      }
    );
  }, [url]);

  return <PhotoFrame texture={texture} treePos={treePos} scatterPos={scatterPos} isTree={isTree} index={index} url={url} onSelect={onSelect} error={error} />;
};

const PhotoGallery = ({ isTree, onSelectPhoto }: any) => {
  const items = useMemo(() => {
    return Array.from({ length: 10 }, (_, i) => {
      const y = (1 - i / 9) * 10 - 4.5;
      const r = 4.5 * (1 - (y + 5) / 12);
      const theta = i * 2.4 + Math.PI / 4;
      return {
        url: USER_PROVIDED_PHOTOS[i % USER_PROVIDED_PHOTOS.length],
        treePos: new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)).multiplyScalar(1.2),
        scatterPos: getRandomSpherePoint(22).add(new THREE.Vector3(0, 5, 0))
      };
    });
  }, []);

  return (
    <group>
      {items.map((item, i) => (
        <PhotoItem key={i} index={i} isTree={isTree} {...item} onSelect={onSelectPhoto} />
      ))}
    </group>
  );
};

const Star = ({ isTree }: { isTree: boolean }) => {
  const ref = useRef<THREE.Group>(null!);
  useFrame((state, delta) => {
    ref.current.rotation.y += delta * 2;
    const targetY = isTree ? 6.5 : 12;
    ref.current.position.y = damp(ref.current.position.y, targetY, 4, delta);
    ref.current.scale.setScalar(isTree ? 1 : 0.2);
  });
  return (
    <group ref={ref} position={[0, 12, 0]}>
      <mesh>
        <octahedronGeometry args={[0.6, 0]} />
        <meshBasicMaterial color={PALETTE.gold} />
      </mesh>
      <pointLight color={PALETTE.gold} intensity={5} distance={10} />
    </group>
  );
};

const Scene = ({ isTree, onSelectPhoto }: any) => {
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 3, 16]} fov={50} />
      {/* 核心：autoRotate 始终开启，保持场景灵动 */}
      <OrbitControls 
        autoRotate 
        autoRotateSpeed={0.8} 
        enablePan={false} 
        maxPolarAngle={Math.PI / 2} 
        minDistance={10} 
        maxDistance={25} 
      />
      <Environment preset="night" />
      <ambientLight intensity={0.5} />
      <spotLight position={[10, 15, 10]} intensity={15} color={PALETTE.goldLight} angle={0.5} penumbra={1} />
      <pointLight position={[-10, 5, -10]} intensity={10} color={PALETTE.pinkDeep} />

      <group position={[0, -2, 0]}>
        <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
          <Foliage isTree={isTree} />
          <Ornaments isTree={isTree} />
          <PhotoGallery isTree={isTree} onSelectPhoto={onSelectPhoto} />
          <Star isTree={isTree} />
        </Float>
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.5} intensity={1.2} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={0.8} />
      </EffectComposer>
    </>
  );
};

const UIOverlay = ({ toggle }: any) => (
  <div className="ui-container">
    <div className="ui-header">
      <span className="subtitle">Luxe Experience</span>
      <h1>À toi</h1>
    </div>
    <div className="ui-footer">
      <button className="magic-button" onClick={toggle}>Assemble / Scatter</button>
      <div className="instruction">Flowing Magic • Drag to Explore</div>
    </div>
  </div>
);

const Lightbox = ({ src, close }: any) => {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={close}>
      <img src={src} alt="Memory" />
    </div>
  );
};

const App = () => {
  const [isTree, setIsTree] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ width: "100vw", height: "100vh", background: PALETTE.bg }}>
      <UIOverlay toggle={() => setIsTree(!isTree)} />
      <Lightbox src={selected} close={() => setSelected(null)} />
      <Canvas shadows dpr={[1, 2]}>
        <Suspense fallback={null}>
          <Scene isTree={isTree} onSelectPhoto={setSelected} />
        </Suspense>
      </Canvas>
      <style>{`
        .lightbox {
          position: fixed; top:0; left:0; width:100%; height:100%;
          background: rgba(0,0,0,0.9); z-index: 2000;
          display: flex; align-items: center; justify-content: center;
          cursor: zoom-out; backdrop-filter: blur(10px);
        }
        .lightbox img { max-width: 90%; max-height: 90%; border: 2px solid #ffcf4d; border-radius: 8px; }
      `}</style>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
