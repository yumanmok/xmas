
import React, { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Canvas, useFrame, extend, ThreeElement, useThree } from "@react-three/fiber";
import { easing } from "maath";
import {
  OrbitControls,
  Float,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Stars,
  ContactShadows,
  Loader,
} from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";

/**
 * Global THREE registration to ensure single instance
 */
if (typeof window !== "undefined") {
  (window as any).THREE = THREE;
}

/* ================= Configuration ================= */

const USER_PROVIDED_PHOTOS = [
  "https://img.heliar.top/file/1766344105890_IMG_2593.jpeg",
  "https://img.heliar.top/file/1766390676525_image1.jpg",
  "https://img.heliar.top/file/1766390662772_image5.jpg",
  "https://img.heliar.top/file/1766390661649_image8.jpg",
  "https://img.heliar.top/file/1766390650455_image9.jpg",
  "https://img.heliar.top/file/1766381738623_image7.JPG",
  "https://img.heliar.top/file/1766390670566_10.jpg",
  "https://img.heliar.top/file/1766390668721_image2.jpg",
];

const BACKUP_PHOTOS = [
  "https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=600&q=80",
  "https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=600&q=80",
];

const BACKGROUND_MUSIC_URL = "https://cs1.mp3.pm/download/139557278/TGlCay9pSE9kbG04WjdwMDJNbnFsNGx5aEt0aFhnVllEby9jaTVGcXk1T1JrWU5XVnM1QUNzeUI4NlJJazIrU1QwREFPc0tRS2ZrL3BCSVJnU1Y3SFBHaVNGNnNmVHIvYmVYNk93N1ExdHoxc0FrZUJUV25TOXRjS05ETWdWbVc/back_number_-_full_(mp3.pm).mp3"; 

const PALETTE = {
  bg: "#010806",
  emerald: "#063d2e",
  greenLight: "#4add8c", 
  gold: "#ffcf4d",
  goldLight: "#fff4d1",
  pinkDeep: "#d66ba0",
};

/* ================= Utils ================= */

const damp = (c: number, t: number, l: number, d: number) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * d));

const getRandomSpherePoint = (r: number) => {
  const theta = Math.random() * Math.PI * 2.0;
  const v = Math.random();
  const phi = Math.acos(2.0 * v - 1.0);
  const rad = Math.cbrt(Math.random()) * r;
  return new THREE.Vector3(rad * Math.sin(phi) * Math.cos(theta), rad * Math.sin(phi) * Math.sin(theta), rad * Math.cos(phi));
};

const getRandomConePoint = (h: number, r: number) => {
  const hRaw = 1.0 - Math.cbrt(Math.random()); 
  const y = hRaw * h;
  const rad = r * (1.0 - y / h);
  const theta = Math.random() * Math.PI * 2.0;
  const dist = Math.sqrt(Math.random()) * rad;
  return new THREE.Vector3(dist * Math.cos(theta), y - h / 2.0, dist * Math.sin(theta));
};

const getConeSurfacePoint = (h: number, r: number) => {
  const y = Math.random() * h;
  const rad = r * (1.0 - y / h);
  const theta = Math.random() * Math.PI * 2.0;
  return new THREE.Vector3(rad * Math.cos(theta), y - h / 2.0, rad * Math.sin(theta));
};

// CRITICAL UTILITY: Resize textures on the fly to prevent OOM
const loadOptimizedTexture = (url: string, isMobile: boolean, callback: (texture: THREE.Texture) => void, errorCallback?: () => void) => {
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = url;
  img.onload = () => {
    // Determine max size: 1024 for mobile, 2048 for desktop
    const maxDim = isMobile ? 1024 : 2048;
    let width = img.width;
    let height = img.height;

    // Resize logic
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width *= scale;
      height *= scale;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.drawImage(img, 0, 0, width, height);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      // Disable mipmaps on mobile for extra memory saving
      if (isMobile) {
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
      }
      callback(texture);
    } else {
      // Fallback if canvas context fails
      const texture = new THREE.TextureLoader().load(url);
      callback(texture);
    }
  };
  img.onerror = () => {
    if (errorCallback) errorCallback();
  };
};

// --- Procedural Snowflake Floor Generator ---
function createSnowflakeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Clear background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";

  // Draw 6-sided snowflake
  const drawSnowflake = (x: number, y: number, size: number, alpha: number) => {
    ctx.save();
    ctx.translate(x, y);
    // Warmer gold/cream tint for luxury feel
    ctx.strokeStyle = `rgba(255, 240, 220, ${alpha})`;
    ctx.lineWidth = 2;

    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((Math.PI / 3) * i);

      // Main branch
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -size);
      ctx.stroke();

      // Sub-branches
      const branchPos = [0.3, 0.5, 0.7];
      branchPos.forEach((pos) => {
        const y = -size * pos;
        const branchLen = size * 0.25 * (1 - pos * 0.5);

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(-branchLen, y - branchLen * 0.6);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(branchLen, y - branchLen * 0.6);
        ctx.stroke();
      });

      ctx.restore();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
    ctx.fill();

    ctx.restore();
  };

  // Main snowflake
  drawSnowflake(centerX, centerY, 300, 0.45);

  // Surrounding snowflakes
  const smallSnowflakes = [
    { x: 200, y: 200, size: 80 },
    { x: 824, y: 200, size: 80 },
    { x: 200, y: 824, size: 80 },
    { x: 824, y: 824, size: 80 },
    { x: 512, y: 150, size: 60 },
    { x: 512, y: 874, size: 60 },
    { x: 150, y: 512, size: 60 },
    { x: 874, y: 512, size: 60 },
  ];

  smallSnowflakes.forEach((sf) => {
    drawSnowflake(sf.x, sf.y, sf.size, 0.25);
  });

  // Scattered glitter dots
  ctx.fillStyle = "rgba(255, 207, 77, 0.3)"; // Gold tint
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = Math.random() * 3 + 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/* ================= Custom Materials ================= */

// --- 1. New Foliage Shader (Purple/Pink/Sparkle) ---
const FOLIAGE_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uMix;
  uniform float uPixelRatio; // Added to ensure size consistency across devices
  
  attribute vec3 treePosition;
  attribute float size;
  attribute float speed;
  attribute float pulse;
  
  varying vec3 vColor;
  
  void main() {
    // Current position mixing
    vec3 pos = mix(position, treePosition, uMix);
    
    // Add breathing/wind effect with pulse offset
    float breathing = sin(uTime * 1.5 + pulse) * 0.05;
    pos.y += breathing;
    
    // Prevent clipping through floor (assume floor is at y=0 local)
    if (pos.y < 0.0) pos.y = 0.0;
    
    // Subtle horizontal drift
    pos.x += sin(uTime * speed + pos.y) * 0.02;
    pos.z += cos(uTime * speed + pos.y) * 0.02;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    // Size attenuation (Modified to use uPixelRatio)
    gl_PointSize = size * (400.0 / -mvPosition.z) * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
    
    // Gradient color: Darker Purple -> Muted Pink (Reduced brightness for AdditiveBlending)
    vec3 deepPurple = vec3(0.3, 0.1, 0.3);
    vec3 softPink = vec3(0.7, 0.5, 0.7);
    vec3 sparkle = vec3(0.9, 0.9, 1.0);
    
    // Mix based on height
    float heightFactor = clamp(pos.y / 12.0, 0.0, 1.0);
    vColor = mix(deepPurple, softPink, heightFactor);
    
    // Add sparkles based on speed/randomness
    if (sin(speed * 50.0 + uTime) > 0.95) {
       vColor = mix(vColor, sparkle, 0.7);
    }
  }
`;

const FOLIAGE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  
  void main() {
    // Distance from center of point
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceToCenter > 0.5) discard;

    // Smooth edge glow - slightly tighter center
    float glow = 1.0 - smoothstep(0.1, 0.5, distanceToCenter);
    
    // Output color with reduced opacity
    gl_FragColor = vec4(vColor, glow * 0.5);
  }
`;

// --- 2. Snow Material ---
const SnowMaterial = shaderMaterial(
  {
    uTime: 0,
    uHeight: 30,
    uColor: new THREE.Color("#ffffff"),
    uGlobalOpacity: 0,
    uPixelRatio: 1.0,
  },
  `
    precision mediump float;
    uniform float uTime;
    uniform float uHeight; 
    uniform float uPixelRatio; 
    
    attribute float aSize;
    attribute float aSpeed;
    attribute vec3 aOffset;
    
    varying float vOpacity;
    
    void main() {
      vec3 pos = position;
      float fallOffset = uTime * aSpeed;
      pos.y = mod(position.y - fallOffset, uHeight);
      pos.y -= uHeight * 0.5; 
      
      pos.x += sin(uTime * 0.5 + aOffset.x) * 0.5;
      pos.z += cos(uTime * 0.3 + aOffset.z) * 0.5;
      
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      float finalSize = aSize * uPixelRatio;
      gl_PointSize = finalSize * (350.0 / -mvPosition.z);
      
      float normalizedY = (pos.y + uHeight * 0.5) / uHeight;
      vOpacity = smoothstep(0.0, 0.15, normalizedY) * (1.0 - smoothstep(0.85, 1.0, normalizedY));
    }
  `,
  `
    precision mediump float;
    uniform vec3 uColor;
    uniform float uGlobalOpacity;
    varying float vOpacity;
    
    void main() {
      vec2 xy = gl_PointCoord.xy - vec2(0.5);
      float dist = length(xy);
      if (dist > 0.5) discard;
      float glow = 1.0 - smoothstep(0.0, 0.5, dist);
      glow = pow(glow, 1.2);
      gl_FragColor = vec4(uColor, glow * uGlobalOpacity * vOpacity);
    }
  `
);

extend({ SnowMaterial });

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        snowMaterial: ThreeElement<typeof SnowMaterial>;
      }
    }
  }
}

/* ================= Components ================= */

const Snow = ({ isTree, isMobile }: { isTree: boolean, isMobile: boolean }) => {
  const pointsRef = useRef<THREE.Points>(null!);
  const materialRef = useRef<any>(null!);
  const count = isMobile ? 50 : 500; 
  const height = 30;
  const dpr = useThree((state: any) => state.viewport.dpr);

  const { positions, sizes, speeds, randomOffsets } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);
    const randomOffsets = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40; 
      positions[i * 3 + 1] = (Math.random() - 0.5) * height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 40;
      sizes[i] = Math.random() * 1.5 + 0.5; 
      speeds[i] = Math.random() * 1.5 + 0.5; 
      randomOffsets[i * 3] = Math.random() * 100;
      randomOffsets[i * 3 + 1] = Math.random() * 100;
      randomOffsets[i * 3 + 2] = Math.random() * 100;
    }

    return { positions, sizes, speeds, randomOffsets };
  }, [count]);

  useFrame((state, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = state.clock.elapsedTime;
      const targetOpacity = isTree ? 0.9 : 0.0;
      materialRef.current.uGlobalOpacity = damp(materialRef.current.uGlobalOpacity, targetOpacity, 2, delta);
      materialRef.current.uPixelRatio = dpr;
    }
  });

  return (
    <points ref={pointsRef} position={[0, 5, 0]}> 
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} itemSize={3} array={positions} />
        <bufferAttribute attach="attributes-aSize" count={count} itemSize={1} array={sizes} />
        <bufferAttribute attach="attributes-aSpeed" count={count} itemSize={1} array={speeds} />
        <bufferAttribute attach="attributes-aOffset" count={count} itemSize={3} array={randomOffsets} />
      </bufferGeometry>
      <snowMaterial 
        ref={materialRef} 
        transparent 
        depthWrite={false} 
        blending={THREE.AdditiveBlending}
        toneMapped={false} 
      />
    </points>
  );
};

const MusicPlayer = () => {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(BACKGROUND_MUSIC_URL);
    audio.loop = true;
    audio.volume = 0.15;
    audioRef.current = audio;
    return () => { if (audioRef.current) audioRef.current.pause(); };
  }, []);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(e => console.log("Audio playback waiting for interaction"));
    }
    setPlaying(!playing);
  };

  return (
    <div style={{ position: "fixed", top: "25px", right: "25px", zIndex: 1000, pointerEvents: "auto" }}>
      <button className="magic-button" onClick={toggle} style={{ padding: "8px 16px", fontSize: "0.6rem", minWidth: "110px" }}>
        {playing ? "🔊 MUSIC ON" : "🔈 MUSIC OFF"}
      </button>
    </div>
  );
};

// Replaced Foliage component with new visual style (Purple/Pink Gradient + Flat Bottom Logic)
const Foliage = ({ isTreeShape, count }: { isTreeShape: boolean; count: number }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const dpr = useThree((state: any) => state.viewport.dpr);

  const { positions, treePositions, sizes, speeds, pulses } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const treePositions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const speeds = new Float32Array(count);
    const pulses = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // SCATTER: Random Sphere distribution (Galaxy)
      const r = 14 * Math.cbrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) + 6;
      positions[i * 3 + 2] = r * Math.cos(phi);

      // TREE: Cone distribution
      let h = 12 * (1 - Math.cbrt(Math.random()));
      
      // Reduced base radius from 4.5 to 3.8 for a tighter look
      let maxR = 3.8 * (1.0 - h / 12.5);
      
      // FORCE FLAT BOTTOM:
      // Flatten ~8% of particles to the very bottom to create a defined base rim
      if (Math.random() < 0.08) {
          h = 0.2; // Sit just above floor
          maxR = 3.8; // Base radius
          // Push to edge for rim definition (0.8 - 1.0 of radius)
          const coneR = maxR * (0.8 + Math.random() * 0.2);
          const coneTheta = Math.random() * 2 * Math.PI;
          
          treePositions[i * 3] = coneR * Math.cos(coneTheta);
          treePositions[i * 3 + 1] = h;
          treePositions[i * 3 + 2] = coneR * Math.sin(coneTheta);
      } else {
          // Standard distribution
          const coneR = Math.sqrt(Math.random()) * maxR;
          const coneTheta = Math.random() * 2 * Math.PI;

          treePositions[i * 3] = coneR * Math.cos(coneTheta);
          treePositions[i * 3 + 1] = h;
          treePositions[i * 3 + 2] = coneR * Math.sin(coneTheta);
      }

      sizes[i] = Math.random() * 0.6 + 0.2;
      speeds[i] = Math.random() * 0.5 + 0.5;
      pulses[i] = Math.random() * Math.PI * 2;
    }

    return { positions, treePositions, sizes, speeds, pulses };
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMix: { value: 0 },
      uPixelRatio: { value: 1.0 },
    }),
    []
  );

  useFrame((state, delta) => {
    if (pointsRef.current) {
      const material = pointsRef.current.material as THREE.ShaderMaterial;
      material.uniforms.uTime.value = state.clock.elapsedTime;
      material.uniforms.uPixelRatio.value = dpr;

      // Faster scatter transition (0.6s) than assemble (1.0s)
      easing.damp(
        material.uniforms.uMix,
        "value",
        isTreeShape ? 1 : 0,
        isTreeShape ? 1.0 : 0.6,
        delta
      );
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-treePosition"
          count={treePositions.length / 3}
          array={treePositions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          count={sizes.length}
          array={sizes}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-speed"
          count={speeds.length}
          array={speeds}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-pulse"
          count={pulses.length}
          array={pulses}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={FOLIAGE_VERTEX_SHADER}
        fragmentShader={FOLIAGE_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

// Replaced GroundEffect with the new procedural snowflake floor
const SnowflakeFloor = ({ isTree, isMobile }: { isTree: boolean, isMobile: boolean }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  // Generate the texture once
  const texture = useMemo(() => {
     const t = createSnowflakeTexture();
     if(t) t.colorSpace = THREE.SRGBColorSpace;
     return t;
  }, []);

  useFrame((_, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    // Fade in/out logic using Maath easing for smoothness
    const targetOpacity = isTree ? 0.8 : 0.0;
    const targetScale = isTree ? 1.0 : 0.4;
    
    // Speed up scatter transition
    const smoothTime = isTree ? 0.8 : 0.4;

    easing.damp(materialRef.current, "opacity", targetOpacity, smoothTime, delta);
    easing.damp(meshRef.current.scale, "x", targetScale, smoothTime, delta);
    easing.damp(meshRef.current.scale, "y", targetScale, smoothTime, delta); // y corresponds to z in local space due to rotation
  });

  if (!texture) return null;

  return (
    <group position={[0, -11.6, 0]}>
      {!isMobile && (
        <ContactShadows opacity={0.18} scale={26} blur={6} far={10} color="#000000" position={[0, 0.01, 0]} />
      )}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        scale={[1, 1, 1]} 
      >
        <circleGeometry args={[16, 64]} />
        <meshStandardMaterial
          ref={materialRef}
          map={texture}
          transparent
          opacity={0}
          roughness={0.4}
          metalness={0.6}
          side={THREE.DoubleSide}
          depthWrite={false} // Prevent z-fighting with contact shadows
        />
      </mesh>
    </group>
  );
}

const Ornaments = ({ isTree, isMobile }: { isTree: boolean, isMobile: boolean }) => {
  const count = isMobile ? 30 : 75;
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const geometry = useMemo(() => new THREE.SphereGeometry(1.0, isMobile ? 8 : 16, isMobile ? 8 : 16), [isMobile]);
  
  // OPTIMIZATION: Use Standard Material instead of Physical for mobile performance
  const material = useMemo(() => {
    if (isMobile) {
      return new THREE.MeshStandardMaterial({
        roughness: 0.1,
        metalness: 0.9,
        emissive: new THREE.Color("#080808"),
        emissiveIntensity: 0.4
      });
    }
    return new THREE.MeshPhysicalMaterial({ 
      roughness: 0.1, 
      metalness: 1.0, 
      reflectivity: 1.0,
      envMapIntensity: 1.5,
      emissive: new THREE.Color("#080808"),
      emissiveIntensity: 0.4
    });
  }, [isMobile]);

  const data = useMemo(() => Array.from({ length: count }, () => {
    // FIX: Using correct coordinate space relative to floor (0 to 12)
    // getConeSurfacePoint returns centered coords (y = -h/2 to h/2), so we add 6.1 (approx half height)
    // to align with the new Foliage system (y = 0 to 12)
    const p = getConeSurfacePoint(12.2, 4.4); 
    p.y += 6.1; 
    
    return {
      tree: p.multiplyScalar(1.02),
      scatter: getRandomSpherePoint(26.0).add(new THREE.Vector3(0, 5, 0)),
      scale: 0.14 + Math.random() * 0.14,
      color: Math.random() > 0.5 ? PALETTE.gold : PALETTE.pinkDeep
    };
  }), [count]);

  const mixVal = useRef(0.0);
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    mixVal.current = damp(mixVal.current, isTree ? 1.0 : 0.0, 4, delta);
    data.forEach((d, i) => {
      dummy.position.lerpVectors(d.scatter, d.tree, mixVal.current);
      dummy.scale.setScalar(d.scale * (0.35 + 0.65 * mixVal.current));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    if (!meshRef.current) return;
    data.forEach((d, i) => {
      meshRef.current.setColorAt(i, new THREE.Color(d.color));
    });
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [data]);

  return <instancedMesh ref={meshRef} args={[geometry, material, count]} />;
};

const PhotoItem = ({ url, treePos, scatterPos, isTree, index, onSelect }: any) => {
  const group = useRef<THREE.Group>(null!);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [aspect, setAspect] = useState(1.0);
  const mix = useRef(0.0);
  // Detect mobile
  const isMobile = useMemo(() => /Mobi|Android/i.test(navigator.userAgent), []);

  useEffect(() => {
    // Cleanup previous texture
    return () => { if (texture) texture.dispose(); };
  }, []);

  useEffect(() => {
    const handleTexture = (t: THREE.Texture) => {
      // Cast image to any to prevent unknown type errors with width/height access
      const img = t.image as any;
      if (img) setAspect(img.width / img.height);
      setTexture(t);
    };

    // Load optimized texture instead of raw large file
    loadOptimizedTexture(url, isMobile, handleTexture, () => {
      // Fallback
      loadOptimizedTexture(BACKUP_PHOTOS[index % BACKUP_PHOTOS.length], isMobile, handleTexture);
    });
    
  }, [url, index, isMobile]);

  useFrame((state, delta) => {
    if (!group.current) return;
    mix.current = damp(mix.current, isTree ? 1.0 : 0.0, 4, delta);
    group.current.position.lerpVectors(scatterPos, treePos, mix.current);
    if (isTree && mix.current > 0.8) {
      group.current.lookAt(0, group.current.position.y, 0);
      group.current.rotateY(Math.PI);
    } else {
      group.current.rotation.y = state.clock.elapsedTime * 0.05 + index;
    }
    group.current.scale.setScalar(isTree ? 0.52 : 0.95);
  });

  const h = 1.35;
  const w = h * aspect;

  return (
    <group ref={group} onClick={(e) => { e.stopPropagation(); onSelect(url); }}>
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[w + 0.1, h + 0.1, 0.04]} />
        <meshStandardMaterial color={PALETTE.gold} metalness={0.9} roughness={0.2} emissive={PALETTE.gold} emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[w, h]} />
        {texture ? <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.96} /> : <meshBasicMaterial color="#0b1e15" />}
      </mesh>
    </group>
  );
};

const PhotoGallery = ({ isTree, onSelect }: any) => {
  const items = useMemo(() => USER_PROVIDED_PHOTOS.map((url, i) => {
    // FIX: Adjusted mapping to fit within the 0 to 12 height range of the new tree
    const y = (1.0 - i / USER_PROVIDED_PHOTOS.length) * 8.0 + 2.0; // Range roughly 2 to 10
    const r = 4.6 * (1.0 - (y + 1.0) / 13.0) + 0.6; // Simplified radius calc
    const theta = i * 2.5;
    return {
      url,
      treePos: new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)),
      scatterPos: getRandomSpherePoint(26.0).add(new THREE.Vector3(0, 5, 0))
    };
  }), []);
  return <group>{items.map((p, i) => <PhotoItem key={i} index={i} isTree={isTree} {...p} onSelect={onSelect} />)}</group>;
};

const StarTop = ({ isTree }: { isTree: boolean }) => {
  const ref = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    const innerRadius = 0.4;
    const outerRadius = 1.0;
    for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5.0;
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }, []);

  const extrudeSettings = useMemo(() => ({ depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3 }), []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * 1.5;
    // FIX: Increased height target to 12.5 to sit on top of the new tree foliage
    const targetY = isTree ? 12.5 : 40.0;
    ref.current.position.y = damp(ref.current.position.y, targetY, 4, delta);
    ref.current.scale.setScalar(isTree ? 1.4 : 0.01);
  });

  return (
    <group ref={ref} position={[0, 15, 0]}>
      <mesh ref={meshRef}> 
        <extrudeGeometry args={[shape, extrudeSettings]} />
        <meshStandardMaterial color={PALETTE.gold} emissive={PALETTE.gold} emissiveIntensity={3.5} toneMapped={false} />
      </mesh>
      <pointLight color={PALETTE.gold} intensity={10} distance={18} />
    </group>
  );
};

const Scene = ({ isTree, onSelectPhoto }: any) => {
  // Explicitly type state as any to avoid 'unknown' errors when accessing size
  const size = useThree((state: any) => state.size) as { width: number; height: number };
  const isMobile = size.width < 768;
  const fov = isMobile ? 65 : 45;
  const cameraDist = isMobile ? 36 : 30;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 4, cameraDist]} fov={fov} />
      <OrbitControls 
        autoRotate 
        autoRotateSpeed={0.15} 
        enablePan={false} 
        maxPolarAngle={Math.PI / 1.75} 
        minDistance={10} 
        maxDistance={70}
        enableDamping={true}
        dampingFactor={0.05}
      />
      
      <Environment preset="night" />
      <ambientLight intensity={0.25} />
      <spotLight position={[20, 50, 20]} intensity={45} color={PALETTE.goldLight} angle={0.4} penumbra={1} castShadow />
      <pointLight position={[-15, 10, -15]} intensity={6} color={PALETTE.pinkDeep} />

      {/* Increased star count for mobile */}
      <Stars radius={120} depth={60} count={isMobile ? 1500 : 4000} factor={4} saturation={0} fade speed={1.2} />
      
      <Snow isTree={isTree} isMobile={isMobile} />

      {/* FIX: Moved main group to y = -11.6 to sit on the floor */}
      <group position={[0, -11.6, 0]}>
        <Float speed={1.2} rotationIntensity={0.05} floatIntensity={0.08}>
          <Foliage isTreeShape={isTree} count={isMobile ? 2000 : 5000} />
          <Ornaments isTree={isTree} isMobile={isMobile} />
          <PhotoGallery isTree={isTree} onSelect={onSelectPhoto} />
          <StarTop isTree={isTree} />
        </Float>
      </group>
      
      {/* Replaced old GroundEffect with new SnowflakeFloor */}
      <SnowflakeFloor isTree={isTree} isMobile={isMobile} />

      {/* 
         RESTORED EFFECTS FOR MOBILE:
         Since we fixed the VRAM issue via texture resizing, we can safely bring back Bloom.
         We keep multisampling=0 for performance.
      */}
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom 
          luminanceThreshold={0.2} 
          intensity={isMobile ? 0.8 : 1.1} 
          mipmapBlur={true} 
          radius={0.5} 
        />
        <Vignette darkness={0.8} offset={0.1} />
        <Noise opacity={0.015} /> 
      </EffectComposer>
    </>
  );
};

/* ================= UI Components ================= */

const UIOverlay = ({ isTree, toggle }: any) => (
  <div className="ui-container">
    <div className="ui-header">
      <span className="subtitle">クリスマス</span>
      <h1 style={{fontSize: "1.8rem"}}>À toi</h1>
    </div>
    <div className="ui-footer">
      <button className="magic-button" onClick={toggle} style={{pointerEvents: "auto"}}>
        {isTree ? "CLICK" : "Assemble Tree"}
      </button>
      <div className="instruction">YUMAN</div>
    </div>
  </div>
);

const Lightbox = ({ src, close }: any) => {
  if (!src) return null;
  return (
    <div className="lightbox" onClick={close}>
      <img src={src} alt="Memory" />
      <div style={{ position: "absolute", bottom: "40px", color: "white", opacity: 0.5, fontSize: "10px", letterSpacing: "3px" }}>
        TAP TO EXIT
      </div>
    </div>
  );
};

const App = () => {
  const [isTree, setIsTree] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  // CRITICAL FIX: Cap Mobile DPR at 1.5 to prevent OOM
  const dpr = useMemo(() => {
      if (typeof window === 'undefined') return 1;
      const isMobile = /Mobi|Android/i.test(navigator.userAgent);
      return isMobile ? Math.min(1.5, window.devicePixelRatio || 1) : Math.min(2, window.devicePixelRatio || 1);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", background: PALETTE.bg, position: "fixed", overflow: "hidden" }}>
      <UIOverlay isTree={isTree} toggle={() => setIsTree(!isTree)} />
      <MusicPlayer />
      <Lightbox src={selected} close={() => setSelected(null)} />
      <Loader 
        containerStyles={{ background: PALETTE.bg }} 
        innerStyles={{ width: '200px', height: '10px', background: '#333' }}
        barStyles={{ background: PALETTE.gold, height: '10px' }}
        dataStyles={{ color: PALETTE.gold, fontFamily: 'Inter', fontSize: '12px' }}
      />
      <Canvas 
        shadows 
        dpr={dpr}
        gl={{ 
          antialias: false, 
          toneMapping: THREE.ACESFilmicToneMapping,
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,
          depth: true,
          failIfMajorPerformanceCaveat: false
        }}
        onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color(PALETTE.bg));
        }}
      >
        <Suspense fallback={null}>
          <Scene isTree={isTree} onSelectPhoto={setSelected} />
        </Suspense>
      </Canvas>
      <style>{`
        .lightbox {
          position: fixed; top:0; left:0; width:100%; height:100%;
          background: rgba(0,0,0,0.985); z-index: 2000;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          cursor: pointer; backdrop-filter: blur(15px);
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .lightbox img { 
          max-width: 90%; max-height: 80%; 
          border: 1px solid rgba(255, 207, 77, 0.2); 
          box-shadow: 0 0 50px rgba(0, 0, 0, 1.0);
          object-fit: contain;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

const rootElement = document.getElementById("root");
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(<App />);
}
