import React, { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useFrame, extend, Object3DNode } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";

// ================= 类型定义 (消除 TS 报错) =================

// 扩展 Three 元素类型，以便 R3F 识别自定义 shader
declare global {
  namespace JSX {
    interface IntrinsicElements {
      foliageMaterial: Object3DNode<THREE.ShaderMaterial, typeof FoliageMaterial> & {
        uTime?: number;
        uMix?: number;
        uColorBottom?: THREE.Color;
        uColorTop?: THREE.Color;
        uPixelRatio?: number;
        transparent?: boolean;
        depthWrite?: boolean;
        blending?: THREE.Blending;
      };
    }
  }
}

/* ================= 资源配置 ================= */

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

// 注意：原链接看起来像临时链接，这里换成了一个稳定的免费音频源作为演示。
// 如果要在生产环境使用，建议将 mp3 放在 public 文件夹下，用 "/music.mp3" 引用。
const BACKGROUND_MUSIC_URL = "https://cdn.pixabay.com/download/audio/2022/10/18/audio_31c2730e64.mp3";

const PALETTE = {
  bg: "#02120b",
  emerald: "#0d3d2e",
  greenLight: "#4add8c",
  gold: "#ffcf4d",
  goldLight: "#fff0c0",
  pinkDeep: "#d66ba0",
};

/* ================= 数学工具 ================= */

const damp = (c: number, t: number, l: number, d: number) =>
  THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * d));

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

const getRandomConePoint = (h: number, r: number) => {
  const hRaw = 1 - Math.cbrt(Math.random());
  const y = hRaw * h;
  const rad = r * (1 - y / h);
  const theta = Math.random() * Math.PI * 2;
  const dist = Math.sqrt(Math.random()) * rad;
  return new THREE.Vector3(
    dist * Math.cos(theta),
    y - h / 2,
    dist * Math.sin(theta)
  );
};

/* ================= Shader Material ================= */

const FoliageMaterial = shaderMaterial(
  {
    uTime: 0,
    uMix: 0,
    uColorBottom: new THREE.Color(PALETTE.emerald),
    uColorTop: new THREE.Color(PALETTE.greenLight),
    uPixelRatio: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 2) : 1,
  },
  // Vertex Shader
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
    vec3 pos = mix(aScatterPos, aTreePos, uMix);

    // 树形态时的微动风效
    if (uMix > 0.5) {
      pos.x += cos(uTime + aRandom * 10.0) * 0.15 * uMix;
      pos.z += sin(uTime + aRandom * 10.0) * 0.15 * uMix;
      pos.y += sin(uTime + aRandom * 6.0) * 0.1 * uMix;
    }

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = (8.0 + aRandom * 6.0) * uPixelRatio;
    size *= (15.0 / max(0.5, -mv.z));
    gl_PointSize = clamp(size, 0.0, 100.0);

    float h = (aTreePos.y + 6.0) / 12.0;
    vColor = mix(uColorBottom, uColorTop, h);
    vAlpha = 0.8 + 0.2 * uMix;
  }
  `,
  // Fragment Shader
  `
  precision highp float;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float s = 1.0 - smoothstep(0.2, 0.5, d);
    gl_FragColor = vec4(vColor, vAlpha * s);
  }
  `
);

extend({ FoliageMaterial });

/* ================= 粒子树组件 ================= */

const Foliage = ({ isTree }: { isTree: boolean }) => {
  const count = 4000;
  const mat = useRef<any>(null);

  const data = useMemo(() => {
    const scatter = new Float32Array(count * 3);
    const tree = new Float32Array(count * 3);
    const rnd = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const s = getRandomSpherePoint(18);
      s.y += 5;
      const t = getRandomConePoint(13, 4.5);
      scatter.set([s.x, s.y, s.z], i * 3);
      tree.set([t.x, t.y, t.z], i * 3);
      rnd[i] = Math.random();
    }
    return { scatter, tree, rnd };
  }, []);

  useFrame((state, delta) => {
    if (!mat.current) return;
    mat.current.uTime = state.clock.elapsedTime;
    mat.current.uMix = damp(mat.current.uMix, isTree ? 1 : 0, 3, delta);
  });

  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={data.scatter} itemSize={3} />
        <bufferAttribute attach="attributes-aScatterPos" count={count} array={data.scatter} itemSize={3} />
        <bufferAttribute attach="attributes-aTreePos" count={count} array={data.tree} itemSize={3} />
        <bufferAttribute attach="attributes-aRandom" count={count} array={data.rnd} itemSize={1} />
      </bufferGeometry>
      <foliageMaterial ref={mat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

/* ================= 照片系统 (优化版) ================= */

const PhotoItem = ({ url, treePos, scatterPos, isTree, index, onSelect }: any) => {
  const group = useRef<THREE.Group>(null);
  const mix = useRef(0);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspect, setAspect] = useState(1); // 记录图片宽高比

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    // 允许跨域
    loader.setCrossOrigin("Anonymous");

    const handleLoad = (t: THREE.Texture) => {
      // 颜色空间校正，必须设置，否则图片发白
      t.colorSpace = THREE.SRGBColorSpace; 
      
      // 计算宽高比
      if (t.image) {
        setAspect(t.image.width / t.image.height);
      }
      setTexture(t);
    };

    const handleError = () => {
      // 加载失败时使用备用图
      loader.load(BACKUP_PHOTOS[index % BACKUP_PHOTOS.length], (backupT) => {
        backupT.colorSpace = THREE.SRGBColorSpace;
        setTexture(backupT);
      });
    };

    loader.load(url, handleLoad, undefined, handleError);

    return () => {
      if (texture) texture.dispose();
    };
  }, [url, index]);

  useFrame((_, delta) => {
    if (!group.current) return;
    mix.current = damp(mix.current, isTree ? 1 : 0, 4, delta);
    group.current.position.lerpVectors(scatterPos, treePos, mix.current);
    
    // 始终面向中心轴，但保持垂直
    group.current.lookAt(0, group.current.position.y, 0);
    
    // 树形态时稍微缩小
    const scale = isTree ? 0.8 : 1.2;
    group.current.scale.setScalar(scale);
  });

  // 基础高度
  const baseHeight = 1.2;
  // 基础宽度 = 高度 * 宽高比
  const baseWidth = baseHeight * aspect;

  return (
    <group ref={group} onClick={(e) => (e.stopPropagation(), onSelect(url))}>
      <mesh>
        {/* 动态调整几何体形状，防止拉伸 */}
        <planeGeometry args={[baseWidth, baseHeight]} />
        {texture ? (
          <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent />
        ) : (
          <meshBasicMaterial color="#333" />
        )}
      </mesh>
      {/* 边框效果 */}
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[baseWidth + 0.1, baseHeight + 0.1]} />
        <meshBasicMaterial color={PALETTE.bg} />
      </mesh>
    </group>
  );
};

const PhotoGallery = ({ isTree, onSelect }: any) => {
  const items = useMemo(
    () =>
      Array.from({ length: USER_PROVIDED_PHOTOS.length }, (_, i) => {
        // 螺旋排布算法
        const y = (1 - i / USER_PROVIDED_PHOTOS.length) * 10 - 4;
        const r = 4.5 * (1 - (y + 5) / 12) + 0.5; // 稍微向外扩一点
        const a = i * 2.4; // 角度步进
        return {
          url: USER_PROVIDED_PHOTOS[i],
          treePos: new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)),
          scatterPos: getRandomSpherePoint(22).add(new THREE.Vector3(0, 5, 0)),
        };
      }),
    []
  );

  return (
    <>
      {items.map((p, i) => (
        <PhotoItem key={i} index={i} isTree={isTree} {...p} onSelect={onSelect} />
      ))}
    </>
  );
};

/* ================= 顶部星星 ================= */

const Star = ({ isTree }: { isTree: boolean }) => {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 1.5;
    // 树模式下星星在顶部，散落模式下飞向高空
    ref.current.position.y = damp(ref.current.position.y, isTree ? 6.8 : 20, 4, delta);
    // 散落模式下缩小
    const scale = damp(ref.current.scale.x, isTree ? 1 : 0, 4, delta);
    ref.current.scale.setScalar(scale);
  });
  return (
    <group ref={ref} position={[0, 12, 0]}>
      <mesh>
        <octahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial 
            color={PALETTE.gold} 
            emissive={PALETTE.gold} 
            emissiveIntensity={2} 
            toneMapped={false} 
        />
      </mesh>
      <pointLight distance={10} intensity={5} color={PALETTE.gold} />
    </group>
  );
};

/* ================= 主场景 ================= */

const Scene = ({ isTree, onSelect }: any) => (
  <>
    <PerspectiveCamera makeDefault position={[0, 2, 18]} fov={50} />
    <OrbitControls 
        autoRotate={isTree} // 仅在树模式下自动旋转
        autoRotateSpeed={0.5} 
        enablePan={false} 
        maxPolarAngle={Math.PI / 1.4} // 限制视角不能钻到地底
        minDistance={5}
        maxDistance={30}
    />
    
    <Environment preset="night" background={false} />
    
    <ambientLight intensity={0.2} />
    <spotLight position={[10, 15, 10]} intensity={10} color={PALETTE.goldLight} angle={0.5} penumbra={1} />

    <group position={[0, -2, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
        <Foliage isTree={isTree} />
        <PhotoGallery isTree={isTree} onSelect={onSelect} />
        <Star isTree={isTree} />
      </Float>
    </group>

    <EffectComposer disableNormalPass>
      <Bloom luminanceThreshold={0.2} mipmapBlur intensity={1.5} radius={0.6} />
      <Vignette darkness={0.6} offset={0.3} />
    </EffectComposer>
  </>
);

/* ================= 音乐播放器 ================= */

const MusicPlayer = () => {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    audio.current = new Audio(BACKGROUND_MUSIC_URL);
    audio.current.loop = true;
    audio.current.volume = 0.5;
    audio.current.crossOrigin = "anonymous";
    
    return () => {
      audio.current?.pause();
      audio.current = null;
    };
  }, []);

  const toggle = () => {
    if (!audio.current) return;
    if (playing) {
      audio.current.pause();
    } else {
      audio.current.play().catch((e) => console.warn("Audio autoplay blocked:", e));
    }
    setPlaying(!playing);
  };

  return (
    <button
      style={{
        position: "absolute",
        top: 20,
        right: 20,
        zIndex: 10,
        background: "rgba(255,255,255,0.1)",
        border: "1px solid rgba(255,255,255,0.2)",
        color: "white",
        padding: "8px 16px",
        borderRadius: "20px",
        cursor: "pointer",
        backdropFilter: "blur(4px)",
      }}
      onClick={toggle}
    >
      {playing ? "🎵 BGM ON" : "🔇 BGM OFF"}
    </button>
  );
};

/* ================= 图片查看器 (Lightbox) ================= */

const Lightbox = ({ src, close }: any) =>
  src ? (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.9)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        cursor: "pointer",
        backdropFilter: "blur(10px)"
      }}
    >
      <img 
        src={src} 
        alt="Full view"
        style={{ 
            maxWidth: "90vw", 
            maxHeight: "90vh", 
            boxShadow: "0 0 40px rgba(0,0,0,0.5)",
            border: "2px solid #fff",
            borderRadius: "4px"
        }} 
      />
      <div style={{
          position: "absolute",
          bottom: 40,
          color: "white",
          opacity: 0.7,
          fontFamily: "sans-serif"
      }}>点击任意处关闭</div>
    </div>
  ) : null;

/* ================= 主应用 ================= */

const App = () => {
  const [isTree, setIsTree] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ 
        width: "100vw", 
        height: "100vh", 
        background: PALETTE.bg,
        overflow: "hidden" 
    }}>
      <MusicPlayer />

      <button
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 10,
          background: "rgba(13, 61, 46, 0.6)",
          border: `1px solid ${PALETTE.greenLight}`,
          color: PALETTE.greenLight,
          padding: "10px 24px",
          borderRadius: "4px",
          cursor: "pointer",
          fontWeight: "bold",
          transition: "all 0.3s"
        }}
        onClick={() => setIsTree(!isTree)}
      >
        {isTree ? "✨ Scatter Stars" : "🎄 Assemble Tree"}
      </button>

      <Lightbox src={selected} close={() => setSelected(null)} />

      <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
        <Suspense fallback={null}>
          <Scene isTree={isTree} onSelect={setSelected} />
        </Suspense>
      </Canvas>
      
      {/* 底部版权/提示 */}
      <div style={{
          position: "absolute",
          bottom: 20,
          width: "100%",
          textAlign: "center",
          color: "rgba(255,255,255,0.3)",
          pointerEvents: "none",
          fontSize: "12px",
          fontFamily: "sans-serif"
      }}>
        Drag to rotate • Click photos to view
      </div>
    </div>
  );
};

// 假设这是一个单独的入口文件，直接渲染
const container = document.getElementById("root");
if (container) {
    createRoot(container).render(<App />);
}
