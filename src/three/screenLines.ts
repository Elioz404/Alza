/**
 * Lines of a set width on screen, wider than the one device pixel a GPU draws a line with: the
 * plan's marks in the model (marks.ts) are drawn with them, so a selection reads at a glance.
 *
 * Each segment is a quad, made from one small instanced strip and the segment's two ends; the
 * vertex shader turns the strip across the segment as the camera sees it and makes it
 * `linewidth` CSS pixels wide (the canvas's size in CSS pixels is the `resolution`), square at
 * its ends. A dashed line breaks every `dashSize + gapSize` metres along each segment. The
 * colour is written in the output colour space, untouched by tone mapping or fog, so a mark is
 * the token's exact colour on screen, as the plan's marks are.
 *
 * three.js ships the same idea in its examples (LineSegments2, LineMaterial) with much more
 * (world-unit widths, alpha-to-coverage, wireframe helpers) and three times the code in the
 * page's 3D chunk; this is what the marks need of it.
 */

import * as THREE from "three";

const vertexShader = /* glsl */ `
uniform float linewidth;
uniform vec2 resolution;
attribute vec3 instanceStart;
attribute vec3 instanceEnd;
attribute float instanceLength;
varying float vDistance;

// a segment that runs behind the camera is cut at the near plane, so it still points the right way
void trimSegment(const in vec4 start, inout vec4 end) {
  float a = projectionMatrix[2][2];
  float b = projectionMatrix[3][2];
  float nearEstimate = -0.5 * b / a;
  float alpha = (nearEstimate - start.z) / (end.z - start.z);
  end.xyz = mix(start.xyz, end.xyz, alpha);
}

void main() {
  float aspect = resolution.x / resolution.y;
  vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
  vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);
  vDistance = position.y < 0.5 ? 0.0 : instanceLength;
  if (projectionMatrix[2][3] == -1.0) {
    if (start.z < 0.0 && end.z >= 0.0) trimSegment(start, end);
    else if (end.z < 0.0 && start.z >= 0.0) trimSegment(end, start);
  }
  vec4 clipStart = projectionMatrix * start;
  vec4 clipEnd = projectionMatrix * end;
  vec2 dir = clipEnd.xy / clipEnd.w - clipStart.xy / clipStart.w;
  dir.x *= aspect;
  dir = normalize(dir);
  vec2 offset = vec2(dir.y, -dir.x);
  dir.x /= aspect;
  offset.x /= aspect;
  if (position.x < 0.0) offset *= -1.0;
  if (position.y < 0.0) offset -= dir;
  else if (position.y > 1.0) offset += dir;
  offset *= linewidth / resolution.y;
  vec4 clip = position.y < 0.5 ? clipStart : clipEnd;
  clip.xy += offset * clip.w;
  gl_Position = clip;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float gapSize;
varying float vDistance;

void main() {
  #ifdef DASHED
  if (mod(vDistance, dashSize + gapSize) > dashSize) discard;
  #endif
  gl_FragColor = vec4(diffuse, opacity);
  #include <colorspace_fragment>
}
`;

export interface ScreenLineParameters {
  color: THREE.ColorRepresentation;
  /** CSS pixels */
  linewidth: number;
  opacity?: number;
  transparent?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
  /** dashes and gaps along each segment, metres */
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
}

export class ScreenLineMaterial extends THREE.ShaderMaterial {
  readonly isScreenLineMaterial = true;

  constructor({ color, linewidth, opacity = 1, transparent = false, depthTest = true, depthWrite = true, dashed = false, dashSize = 1, gapSize = 1 }: ScreenLineParameters) {
    super({
      uniforms: {
        diffuse: { value: new THREE.Color(color) },
        opacity: { value: opacity },
        linewidth: { value: linewidth },
        resolution: { value: new THREE.Vector2(1, 1) },
        dashSize: { value: dashSize },
        gapSize: { value: gapSize },
      },
      vertexShader,
      fragmentShader,
      transparent,
      depthTest,
      depthWrite,
    });
    this.toneMapped = false;
    this.fog = false;
    if (dashed) this.defines.DASHED = "";
    // ShaderMaterial's own opacity is not the one the shader reads: keep them one
    this.opacity = opacity;
  }

  get color(): THREE.Color {
    return this.uniforms.diffuse.value as THREE.Color;
  }
  /** CSS pixels (ShaderMaterial's own line width, which WebGL caps at one pixel, is this uniform here) */
  get linewidth(): number {
    return (this.uniforms?.linewidth?.value as number | undefined) ?? 1;
  }
  set linewidth(width: number) {
    // ShaderMaterial sets its default before the uniforms exist: that one is not ours
    if (this.uniforms?.linewidth) this.uniforms.linewidth.value = width;
  }
  get dashed(): boolean {
    return "DASHED" in this.defines;
  }
  /** The canvas's size in CSS pixels, which a line's width on screen is reckoned in. */
  get resolution(): THREE.Vector2 {
    return this.uniforms.resolution.value as THREE.Vector2;
  }
}

/** The strip one segment is drawn from: a quad along it and a square cap past each end. */
const STRIP = Object.freeze({
  position: [-1, 2, 0, 1, 2, 0, -1, 1, 0, 1, 1, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, 1, -1, 0],
  index: [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5],
});

/**
 * Segments (each six numbers: its two end points) drawn `material`'s width on screen. Not
 * frustum-culled (its bounds are its strip's, not the segments'), never raycast.
 */
export function screenLines(segments: readonly number[], material: ScreenLineMaterial): THREE.Mesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(STRIP.position, 3));
  geometry.setIndex(STRIP.index);
  const ends = new THREE.InstancedInterleavedBuffer(new Float32Array(segments), 6, 1);
  geometry.setAttribute("instanceStart", new THREE.InterleavedBufferAttribute(ends, 3, 0));
  geometry.setAttribute("instanceEnd", new THREE.InterleavedBufferAttribute(ends, 3, 3));
  const lengths = new Float32Array(segments.length / 6);
  for (let i = 0; i < lengths.length; i++) {
    const s = i * 6;
    lengths[i] = Math.hypot(segments[s + 3] - segments[s], segments[s + 4] - segments[s + 1], segments[s + 5] - segments[s + 2]);
  }
  geometry.setAttribute("instanceLength", new THREE.InstancedBufferAttribute(lengths, 1));
  geometry.instanceCount = lengths.length;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}
