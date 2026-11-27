/* ==========================================================================
   P3Nomads — main.js
   Behaviour only. This script never creates HTML elements: everything you
   see is in the HTML, this file only draws on the existing <canvas>, toggles
   classes and attributes, and updates text that is already there.
   ========================================================================== */

(() => {
  "use strict";

  const root = document.documentElement;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ------------------------------------------------------------------------
     1. The water: a WebGL2 fragment shader on the fixed canvas.
        Slow currents drawn as contour lines in the logo blue; a warm orange
        light follows the pointer and grows towards the invitation.
     --------------------------------------------------------------------- */

  const VERT = `#version 300 es
  in vec2 a;
  void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
  precision highp float;
  uniform vec2  u_res;
  uniform float u_time;
  uniform vec2  u_mouse;   // pixels, origin bottom-left
  uniform float u_scroll;  // page scroll in viewport heights
  uniform float u_warm;    // 0..1, how much warmth the current section asks for
  out vec4 outColor;

  const vec3 DEEP   = vec3(0.027, 0.180, 0.345);
  const vec3 BLUE   = vec3(0.063, 0.306, 0.541);  // #104E8A
  const vec3 LIGHT  = vec3(0.420, 0.650, 0.860);
  const vec3 ORANGE = vec3(0.925, 0.412, 0.231);  // #EC693B

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 s = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;      // screen space
    vec2 m = (u_mouse - 0.5 * u_res) / u_res.y;
    vec2 p = s + vec2(0.0, -u_scroll * 0.35);                 // the water moves with the page
    float t = u_time * 0.035;

    float md = length(s - m);
    float near = exp(-md * md * 5.0);

    // domain-warped currents; the pointer gently stirs them
    vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t)), fbm(p * 1.1 + vec2(5.2, -t * 0.8)));
    float f = fbm(p * 1.35 + 1.9 * q + near * 0.45 * (s - m));

    // contour lines of the current, antialiased
    float v = f * 13.0;
    float line = 1.0 - smoothstep(0.0, 1.6, abs(fract(v) - 0.5) / fwidth(v));
    float major = 1.0 - smoothstep(0.0, 2.2, abs(fract(v / 4.0) - 0.5) / fwidth(v / 4.0));

    vec3 col = mix(DEEP, BLUE, smoothstep(0.2, 0.85, f + 0.25 * q.x));
    col += LIGHT * (0.07 * line + 0.12 * major);

    // warmth: the lamp at the pointer, and a glow rising from below
    float lamp = near * (0.35 + 0.45 * u_warm);
    float rise = u_warm * smoothstep(0.75, -0.55, s.y) * (0.35 + 0.65 * q.y);
    float warmth = clamp(lamp + 0.55 * rise, 0.0, 1.0);
    col = mix(col, ORANGE, warmth * 0.42);
    col += ORANGE * (line + major) * warmth * 0.55;

    // soft vignette and a little grain against banding
    col *= 1.0 - 0.28 * dot(s, s);
    col += (hash(gl_FragCoord.xy + u_time) - 0.5) * 0.018;

    outColor = vec4(col, 1.0);
  }`;

  const canvas = document.getElementById("water");
  const warmSections = Array.from(document.querySelectorAll("[data-warm]"));
  const water = { gl: null, uniforms: {}, warm: 0.25, mouse: [0, 0], target: [0, 0], start: performance.now(), running: false };

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "shader error");
    }
    return shader;
  }

  function startWater() {
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return; // CSS gradient fallback stays visible

    // Without a graphics chip the water would be drawn by the processor and
    // slow the page down. On such devices the calm CSS gradient stays instead.
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) return;

    try {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link error");
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const location = gl.getAttribLocation(program, "a");
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

      for (const name of ["u_res", "u_time", "u_mouse", "u_scroll", "u_warm"]) {
        water.uniforms[name] = gl.getUniformLocation(program, name);
      }
    } catch (error) {
      console.warn("P3Nomads: WebGL water disabled.", error);
      return;
    }

    water.gl = gl;
    resizeWater();
    water.target = [canvas.width * 0.72, canvas.height * 0.62];
    water.mouse = water.target.slice();
    root.classList.add("gl");

    window.addEventListener("resize", resizeWater, { passive: true });
    window.addEventListener("pointermove", (event) => {
      const scale = canvas.width / window.innerWidth;
      water.target = [event.clientX * scale, (window.innerHeight - event.clientY) * scale];
    }, { passive: true });
    window.addEventListener("scroll", () => { if (calm.matches) drawWater(performance.now()); }, { passive: true });
    document.addEventListener("visibilitychange", loopWater);
    calm.addEventListener("change", loopWater);
    canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); root.classList.remove("gl"); water.gl = null; });

    loopWater();
  }

  function resizeWater() {
    // The water is soft and blurred by nature, so it is drawn at reduced
    // resolution and scaled up by CSS. This keeps the processor free.
    const ratio = 0.5;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    if (water.gl) {
      water.gl.viewport(0, 0, canvas.width, canvas.height);
      if (calm.matches) drawWater(performance.now());
    }
  }

  /* Which section is in the middle of the screen, and how warm does it want the water? */
  function wantedWarmth() {
    const middle = window.innerHeight * 0.5;
    for (const section of warmSections) {
      const box = section.getBoundingClientRect();
      if (box.top <= middle && box.bottom >= middle) return Number(section.dataset.warm) || 0;
    }
    return water.warm;
  }

  function drawWater(now) {
    const { gl, uniforms } = water;
    if (!gl) return;
    const time = calm.matches ? 12 : (now - water.start) / 1000;
    water.warm += (wantedWarmth() - water.warm) * (calm.matches ? 1 : 0.035);
    water.mouse[0] += (water.target[0] - water.mouse[0]) * 0.06;
    water.mouse[1] += (water.target[1] - water.mouse[1]) * 0.06;

    gl.uniform2f(uniforms.u_res, canvas.width, canvas.height);
    gl.uniform1f(uniforms.u_time, time);
    gl.uniform2f(uniforms.u_mouse, water.mouse[0], water.mouse[1]);
    gl.uniform1f(uniforms.u_scroll, window.scrollY / window.innerHeight);
    gl.uniform1f(uniforms.u_warm, water.warm);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function loopWater() {
    const shouldRun = Boolean(water.gl) && !document.hidden && !calm.matches;
    if (!shouldRun) {
      water.running = false;
      drawWater(performance.now()); // one still frame
      return;
    }
    if (water.running) return;
    water.running = true;
    let last = 0;
    const frame = (now) => {
      if (!water.running) return;
      if (now - last >= 33) { last = now; drawWater(now); } // at most 30 frames per second
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
     2. Navigation: mark the section you are reading, close the menu on choice
     --------------------------------------------------------------------- */

  function watchSections() {
    const links = Array.from(document.querySelectorAll('.top__nav a[href^="#"]'));
    const sections = Array.from(document.querySelectorAll("main > section[id]"));
    if (!("IntersectionObserver" in window)) return;

    const reading = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links) {
          if (link.hash === "#" + entry.target.id) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        }
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((section) => reading.observe(section));

    // lets the stylesheet hide the docked button while hero or invitation is visible
    const inView = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle("is-inview", entry.isIntersecting);
    }, { threshold: 0.25 });
    document.querySelectorAll(".hero, .invite").forEach((section) => inView.observe(section));
  }

  function closeMenuOnChoice() {
    const menu = document.getElementById("menu");
    if (!menu || typeof menu.hidePopover !== "function") return;
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) menu.hidePopover();
    });
  }

  /* ------------------------------------------------------------------------
     3. Figures count up once, when they come into view
     --------------------------------------------------------------------- */

  function countFigures() {
    const figures = Array.from(document.querySelectorAll("[data-count]"));
    if (!figures.length || calm.matches || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const end = Number(entry.target.dataset.count);
        const began = performance.now();
        const duration = 1400;
        const tick = (now) => {
          const progress = Math.min((now - began) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 4);
          entry.target.textContent = String(Math.round(end * eased));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.6 });
    figures.forEach((figure) => observer.observe(figure));
  }

  // Start the water only after the page has loaded and the browser is idle,
  // and not at all when the visitor asked to save data.
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);
  const whenIdle = (task) => ("requestIdleCallback" in window ? requestIdleCallback(task, { timeout: 2000 }) : setTimeout(task, 300));
  if (!saveData) {
    if (document.readyState === "complete") whenIdle(startWater);
    else window.addEventListener("load", () => whenIdle(startWater), { once: true });
  }
  watchSections();
  closeMenuOnChoice();
  countFigures();
})();
