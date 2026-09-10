import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { REALISTIC_CONFIG } from './config.ts';

/** No UV warp, FOV, jitter, temporal blur or reticle displacement: shots still match pixels. */
export function createFieldOptics() {
  const p = REALISTIC_CONFIG.post;
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, saturation: { value: p.saturation },
      grain: { value: p.grain }, vignette: { value: p.vignette }, aberration: { value: p.aberration } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float time, saturation, grain, vignette, aberration;
      varying vec2 vUv;
      void main(){
        vec2 p=vUv*2.-1.; float r=dot(p,p);
        vec3 c=texture2D(tDiffuse,vUv).rgb;
        // Chromatic fringe only in outer corners, green (luminance) stays aligned.
        vec2 fringe=p*aberration*smoothstep(.75,1.8,r);
        c.r=texture2D(tDiffuse,clamp(vUv+fringe,0.,1.)).r;
        c.b=texture2D(tDiffuse,clamp(vUv-fringe,0.,1.)).b;
        float l=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(l),c,saturation);
        c*=1.-vignette*smoothstep(.38,1.95,r);
        c=mix(c*vec3(.985,1.,1.012),c,smoothstep(.12,.65,l));
        float n=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233))+floor(time*24.)*.13)*43758.5453)-.5;
        c+=n*grain*(.25+.75*(1.-l));
        gl_FragColor=vec4(clamp(c,0.,1.),1.);
      }`,
  });
  pass.enabled = false;
  return pass;
}
