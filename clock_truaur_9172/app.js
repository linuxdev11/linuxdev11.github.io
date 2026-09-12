(function () {
    "use strict";

    // Прямой автозапуск звука без ожидания клика/взаимодействия
    const audio = document.getElementById("bg-audio");
    if (audio) {
        audio.play().catch(() => {});
    }

    const videoElement = document.getElementById("bg-video");
    const container = document.getElementById("pixi-container");

    // Инициализация PixiJS с отключением лишнего сглаживания полноэкранного шейдера
    const app = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x000000,
        resizeTo: window,
        powerPreference: "high-performance",
        antialias: false
    });
    container.appendChild(app.view);

    // Спрайт фонового видео
    const videoTexture = PIXI.Texture.from(videoElement);
    const videoSprite = new PIXI.Sprite(videoTexture);
    videoSprite.width = app.screen.width;
    videoSprite.height = app.screen.height;
    app.stage.addChild(videoSprite);

    // ОПТИМИЗАЦИЯ 1: Карта нормалей с минимальной высотой (16px вместо 1080px).
    // Так как смещение только горизонтальное, масштабирование по вертикали дает
    // точно такой же результат, но уменьшает передачу данных CPU->GPU в 67 раз.
    const MAP_HEIGHT = 16;
    const mapCanvas = document.createElement("canvas");
    const mapCtx = mapCanvas.getContext("2d", { alpha: false });
    mapCanvas.width = window.innerWidth;
    mapCanvas.height = MAP_HEIGHT;

    const mapTexture = PIXI.Texture.from(mapCanvas);
    const mapSprite = new PIXI.Sprite(mapTexture);
    mapSprite.width = app.screen.width;
    mapSprite.height = app.screen.height;

    // Фабричный шейдер оптического преломления (Displacement) PixiJS
    const glassFilter = new PIXI.filters.DisplacementFilter(mapSprite);
    glassFilter.scale.x = 48; // Сила горизонтального сдвига стекла
    glassFilter.scale.y = 0;  // Вертикаль без искажений

    // Легкое размытие по Гауссу
    const blurFilter = new PIXI.filters.BlurFilter();
    blurFilter.blur = 3;
    blurFilter.quality = 3;

    app.stage.addChild(mapSprite);
    videoSprite.filters = [glassFilter, blurFilter];

    // ОПТИМИЗАЦИЯ 2: Предварительно отрендеренный 1D-градиент полосы (256x1).
    // Избавляет от вызова createLinearGradient и выделения памяти 600 раз в секунду.
    const stripeCanvas = document.createElement("canvas");
    stripeCanvas.width = 256;
    stripeCanvas.height = 1;
    const stripeCtx = stripeCanvas.getContext("2d");
    const sGrad = stripeCtx.createLinearGradient(0, 0, 256, 0);
    sGrad.addColorStop(0, "rgb(255, 128, 128)");
    sGrad.addColorStop(0.18, "rgb(170, 128, 128)");
    sGrad.addColorStop(0.82, "rgb(85, 128, 128)");
    sGrad.addColorStop(1, "rgb(0, 128, 128)");
    stripeCtx.fillStyle = sGrad;
    stripeCtx.fillRect(0, 0, 256, 1);

    // Стеклянные полосы с автономной кинематикой
    const lines = [];
    const LINE_COUNT = 10;

    class VerticalLine {
        constructor(initialX = false) {
            this.init(initialX);
        }

        init(initialX = false) {
            this.width = 130 + Math.random() * 180;
            const maxX = Math.max(0, app.screen.width - this.width);

            this.startX = initialX ? Math.random() * maxX : (Math.random() > 0.5 ? 0 : maxX);
            this.x = this.startX;

            // Рассинхронизация старта
            this.initialDelay = Math.random() * 2.5;

            this.pickNewTarget();
        }

        pickNewTarget() {
            const maxX = Math.max(0, app.screen.width - this.width);
            this.startX = this.x;
            this.targetX = Math.random() * maxX;

            const dist = Math.abs(this.targetX - this.startX);

            // Скорость полосы (40 - 220 px/сек)
            const speed = 40 + Math.random() * 180;
            this.duration = Math.max(1.2, dist / speed);

            // ОПТИМИЗАЦИЯ 3: Предрасчет коэффициентов Безье при смене цели
            const p1x = 0.60 + Math.random() * 0.30;
            const p2x = 0.05 + Math.random() * 0.25;
            this.cx = 3.0 * p1x;
            this.bx = 3.0 * (p2x - p1x) - this.cx;
            this.ax = 1.0 - this.cx - this.bx;

            this.elapsedTime = 0;
            this.isPaused = false;
            this.pauseDuration = 0.2 + Math.random() * 2.3;
            this.pauseTimer = 0;
        }

        // Быстрый расчет Безье с предрассчитанными ax, bx, cx и упрощенным Y
        solveEase(t) {
            let currentT = t;
            for (let i = 0; i < 5; i++) {
                const currentX = ((this.ax * currentT + this.bx) * currentT + this.cx) * currentT;
                const derivative = (3.0 * this.ax * currentT + 2.0 * this.bx) * currentT + this.cx;
                if (Math.abs(derivative) < 1e-5) break;
                currentT -= (currentX - t) / derivative;
            }
            currentT = currentT < 0 ? 0 : (currentT > 1 ? 1 : currentT);
            // Аналитическое решение для Y (p1y=0, p2y=1): 3*t^2 - 2*t^3
            return (3.0 - 2.0 * currentT) * currentT * currentT;
        }

        update(dt) {
            if (this.initialDelay > 0) {
                this.initialDelay -= dt;
                return;
            }

            if (this.isPaused) {
                this.pauseTimer += dt;
                if (this.pauseTimer >= this.pauseDuration) {
                    this.pickNewTarget();
                }
                return;
            }

            this.elapsedTime += dt;
            const progress = this.elapsedTime / this.duration;

            if (progress >= 1.0) {
                this.x = this.targetX;
                this.isPaused = true;
                this.pauseTimer = 0;
            } else {
                const ease = this.solveEase(progress);
                this.x = this.startX + (this.targetX - this.startX) * ease;
            }

            const maxX = app.screen.width - this.width;
            if (this.x < 0) this.x = 0;
            else if (this.x > maxX) this.x = maxX;
        }
    }

    function setupLines() {
        const w = app.screen.width;
        const h = app.screen.height;

        mapCanvas.width = w;
        mapCanvas.height = MAP_HEIGHT;
        mapSprite.width = w;
        mapSprite.height = h;
        videoSprite.width = w;
        videoSprite.height = h;

        lines.length = 0;
        for (let i = 0; i < LINE_COUNT; i++) {
            lines.push(new VerticalLine(true));
        }
    }

    // Часовые пояса из URL (?zone=...)
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

    // ОПТИМИЗАЦИЯ 4: Кэширование ссылок на DOM-элементы часов
    const hoursEl = document.getElementById("hours");
    const minutesEl = document.getElementById("minutes");
    const secondsEl = document.getElementById("seconds");

    // ОПТИМИЗАЦИЯ 5: textContent вместо innerText (без layout reflow) + событие animationend
    function updateDigit(container, val) {
        const str = val < 10 ? "0" + val : "" + val;

        if (container.children.length === 0) {
            for (let i = 0; i < 2; i++) {
                const w = document.createElement("div");
                w.className = "digit-container";
                w.innerHTML = `<div class="digit static">${str[i]}</div>`;
                container.appendChild(w);
            }
            return;
        }

        for (let i = 0; i < 2; i++) {
            const w = container.children[i];
            const cur = w.querySelector(".digit:not(.exit)");

            if (cur && cur.textContent !== str[i]) {
                cur.className = "digit exit";
                cur.addEventListener("animationend", () => cur.remove(), { once: true });

                const nxt = document.createElement("div");
                nxt.className = "digit enter";
                nxt.textContent = str[i];
                w.appendChild(nxt);

                nxt.addEventListener("animationend", () => {
                    nxt.className = "digit static";
                }, { once: true });
            }
        }
    }

    function tick() {
        const localTime = new Date();
        const utcTimeInMs = localTime.getTime() + localTime.getTimezoneOffset() * 60000;
        const targetTime = new Date(utcTimeInMs + 3600000 * targetHoursOffset);

        updateDigit(hoursEl, targetTime.getHours());
        updateDigit(minutesEl, targetTime.getMinutes());
        updateDigit(secondsEl, targetTime.getSeconds());
    }

    // Единый RAF-цикл
    let lastTimestamp = 0;
    let lastSecond = -1;

    function animate(timestamp) {
        let dt = (timestamp - lastTimestamp) / 1000;
        if (dt > 0.1) dt = 0.1;
        lastTimestamp = timestamp;

        const w = mapCanvas.width;

        // Нейтральный фон для Displacement (128 = нулевое смещение)
        mapCtx.fillStyle = "rgb(128, 128, 128)";
        mapCtx.fillRect(0, 0, w, MAP_HEIGHT);

        // Отрисовка полос через быстрый drawImage вместо createLinearGradient
        for (let i = 0; i < LINE_COUNT; i++) {
            const line = lines[i];
            line.update(dt);
            mapCtx.drawImage(stripeCanvas, line.x, 0, line.width, MAP_HEIGHT);
        }

        mapTexture.update();

        // Синхронизация секундных тиков
        const currentSecond = Math.floor(timestamp / 1000);
        if (currentSecond !== lastSecond) {
            lastSecond = currentSecond;
            tick();
        }

        requestAnimationFrame(animate);
    }

    window.addEventListener("resize", () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        setupLines();
    });

    setupLines();
    requestAnimationFrame(animate);
})();