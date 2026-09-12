(function () {
    "use strict";

    // Прямой автозапуск звука без ожидания взаимодействия
    const audio = document.getElementById("bg-audio");
    if (audio) {
        audio.play().catch(() => {});
    }

    const video = document.getElementById("bg-video");
    const canvas = document.getElementById("bg-canvas");
    const gl = canvas.getContext("webgl");

    if (!gl) {
        console.error("WebGL не поддерживается");
        return;
    }

    // --- ВЕРШИННЫЙ ШЕЙДЕР ---
    const vsSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

    // --- ФРАГМЕНТНЫЙ ШЕЙДЕР СТЕКЛА (Оптическое преломление + фаски) ---
    const fsSource = `
    precision highp float;
    varying vec2 v_uv;

    uniform sampler2D u_video;
    uniform vec2 u_resolution;
    uniform float u_stripes[32]; // [x, width, x, width, ...]
    uniform int u_count;

    void main() {
      vec2 uv = v_uv;
      float px = gl_FragCoord.x;

      vec2 totalOffset = vec2(0.0);
      float edgeHighlight = 0.0;
      float innerFacet = 0.0;

      // Просчет оптического преломления через толщу каждой полосы
      for (int i = 0; i < 16; i++) {
        if (i >= u_count) break;
        float startX = u_stripes[i * 2];
        float w = u_stripes[i * 2 + 1];
        float endX = startX + w;

        if (px >= startX && px <= endX) {
          // Положение пикселя внутри стеклянной полосы (0.0 - 1.0)
          float normX = (px - startX) / w;

          // Физика фаски: нормаль угла скола ребра стекла
          float slope = 0.0;
          float bevelSize = clamp(14.0 / w, 0.04, 0.15); // ширина фаски

          if (normX < bevelSize) {
            // Левая грань (угол наклона преломления)
            slope = -cos((normX / bevelSize) * 1.57079);
            // Блик направленного света (-45 deg) на фаске
            edgeHighlight += pow(1.0 - (normX / bevelSize), 2.0) * 0.55;
          } else if (normX > (1.0 - bevelSize)) {
            // Правая грань
            float rightNorm = (1.0 - normX) / bevelSize;
            slope = cos(rightNorm * 1.57079);
            edgeHighlight += pow(1.0 - rightNorm, 2.0) * 0.25;
          } else {
            // Тело стекла: плоский параллельный оптический сдвиг фона
            slope = 0.15;
          }

          // Refraction (сдвиг текстурных координат фона в видео)
          totalOffset.x += slope * 0.035; 
          innerFacet += 0.04;
        }
      }

      // Сэмплирование видео со сдвигом нормали (чистое стекло, БЕЗ блюра)
      vec2 refractedUV = clamp(uv + totalOffset, 0.001, 0.999);
      vec4 sceneColor = texture2D(u_video, refractedUV);

      // Наложение чистого света и глубины (монохромный белый свет, без радуги)
      sceneColor.rgb += vec3(edgeHighlight);
      sceneColor.rgb += vec3(innerFacet * 0.3);

      gl_FragColor = sceneColor;
    }
  `;

    // Компиляция шейдеров
    function createShader(gl, type, source) {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        return s;
    }

    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    gl.useProgram(program);

    // Геометрия: квад на весь экран
    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1, -1,  1,
        -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uStripes = gl.getUniformLocation(program, "u_stripes");
    const uCount = gl.getUniformLocation(program, "u_count");

    // Текстура видео
    const videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // --- ПОЛОСЫ СТЕКЛА НА ОСНОВЕ ТВОЕГО КЛАССА ---
    let width, height;
    const lines = [];
    const LINE_COUNT = 7;

    class VerticalLine {
        constructor(initialX = false) {
            this.init(initialX);
        }

        init(initialX = false) {
            this.width = 120 + Math.random() * 180;
            const maxX = Math.max(0, width - this.width);
            this.x = initialX ? Math.random() * maxX : (Math.random() > 0.5 ? 0 : maxX);
            const baseSpeed = 30 + Math.random() * 60;
            this.vx = Math.random() > 0.5 ? baseSpeed : -baseSpeed;
        }

        update(dt) {
            this.x += this.vx * dt;
            const maxX = width - this.width;

            // Строго не выходят за границы ViewPort
            if (this.x <= 0) {
                this.x = 0;
                this.vx = Math.abs(this.vx);
            } else if (this.x >= maxX) {
                this.x = maxX;
                this.vx = -Math.abs(this.vx);
            }
        }
    }

    function setupCanvas() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);

        lines.length = 0;
        for (let i = 0; i < LINE_COUNT; i++) {
            lines.push(new VerticalLine(true));
        }
    }

    // --- ЛОГИКА ЧАСОВ (ТВОЙ КОД) ---
    let targetHoursOffset = 3;
    const urlParams = new URLSearchParams(window.location.search);
    const zoneParam = urlParams.get("zone");

    if (zoneParam) {
        const cleanZone = zoneParam.toLowerCase().trim();
        if (cleanZone === "moscow" || cleanZone === "europe/moscow") {
            targetHoursOffset = 3;
        } else if (cleanZone === "utc") {
            targetHoursOffset = 0;
        } else {
            const match = cleanZone.match(/utc\s*([+-]?\d+)/i) || cleanZone.match(/^([+-]?\d+)$/);
            if (match) {
                targetHoursOffset = parseInt(match[1], 10);
            } else {
                const rawNumber = parseInt(cleanZone.replace("utc", "").replace(" ", ""), 10);
                if (!isNaN(rawNumber)) targetHoursOffset = rawNumber;
            }
        }
    }

    function updateDigit(container, val) {
        const str = String(val).padStart(2, "0");
        if (container.children.length === 0) {
            for (let i = 0; i < 2; i++) {
                const w = document.createElement("div");
                w.className = "digit-container";
                w.innerHTML = `<div class="digit active">${str[i]}</div>`;
                container.appendChild(w);
            }
            return;
        }

        for (let i = 0; i < 2; i++) {
            const w = container.children[i];
            const cur = w.querySelector(".active");
            if (cur && cur.innerText !== str[i]) {
                const nxt = document.createElement("div");
                nxt.className = "digit enter";
                nxt.innerText = str[i];
                w.appendChild(nxt);

                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        cur.classList.replace("active", "exit");
                        nxt.classList.replace("enter", "active");
                    });
                });

                setTimeout(() => cur.remove(), 600);
            }
        }
    }

    function tick() {
        const localTime = new Date();
        const utcTimeInMs = localTime.getTime() + localTime.getTimezoneOffset() * 60000;
        const targetTime = new Date(utcTimeInMs + 3600000 * targetHoursOffset);

        updateDigit(document.getElementById("hours"), targetTime.getHours());
        updateDigit(document.getElementById("minutes"), targetTime.getMinutes());
        updateDigit(document.getElementById("seconds"), targetTime.getSeconds());
    }

    // --- ЕДИНЫЙ ЦИКЛ РЕНДЕРА И ОБНОВЛЕНИЯ ШЕЙДЕРА ---
    let lastTimestamp = 0;
    let lastSecond = -1;
    const stripesData = new Float32Array(32);

    function animate(timestamp) {
        let dt = (timestamp - lastTimestamp) / 1000;
        if (dt > 0.1) dt = 0.1;
        lastTimestamp = timestamp;

        // Обновляем координаты полос
        for (let line of lines) {
            line.update(dt);
        }

        // Загружаем актуальный кадр видео в видеопамять шейдера
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
            gl.bindTexture(gl.TEXTURE_2D, videoTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        }

        // Передаем координаты полос в Uniform GLSL шейдера
        for (let i = 0; i < lines.length; i++) {
            stripesData[i * 2] = lines[i].x;
            stripesData[i * 2 + 1] = lines[i].width;
        }

        gl.uniform2f(uResolution, width, height);
        gl.uniform1i(uCount, lines.length);
        gl.uniform1fv(uStripes, stripesData);

        // Отрисовка кадра с аппаратным шейдером стекла
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Синхронный тик часов
        const currentSecond = Math.floor(timestamp / 1000);
        if (currentSecond !== lastSecond) {
            lastSecond = currentSecond;
            tick();
        }

        requestAnimationFrame(animate);
    }

    window.addEventListener("resize", setupCanvas);
    setupCanvas();
    requestAnimationFrame(animate);
})();