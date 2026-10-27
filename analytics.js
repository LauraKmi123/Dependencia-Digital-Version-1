/* Analítica agregada en vivo. La gráfica se dibuja también si la API aún no está disponible. */
(() => {
    'use strict';

    const sectionIds = ['inicio', 'historia', 'relatos', 'podcast', 'recursos'];
    const labels = {
        inicio: 'Inicio',
        historia: 'Historia',
        relatos: 'Relatos',
        podcast: 'Podcast',
        recursos: 'Autodiagnóstico y Kit de Vida Digital Sana'
    };
    const sliceColors = ['#67e8f9', '#f9a8d4', '#a78bfa', '#fbbf24', '#34d399'];
    const sessionId = getSessionId();
    const seenKey = 'ed-analytics-seen';
    const seen = new Set(readSessionArray(seenKey));
    const canvas = document.getElementById('visitor-analytics-chart');
    const legendContainer = document.getElementById('visitor-analytics-legend');
    const status = document.getElementById('analytics-status');
    const reactionStatus = document.getElementById('reaction-status');
    const reactionButtons = [...document.querySelectorAll('[data-reaction]')];
    const refreshEveryMs = 3000;
    let chart = null;
    let currentSection = null;
    let sectionStartedAt = 0;

    if (!canvas) return;

    function getSessionId() {
        try {
            let id = sessionStorage.getItem('ed-analytics-session');
            if (!id) {
                id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                sessionStorage.setItem('ed-analytics-session', id);
            }
            return id;
        } catch (_) {
            return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
    }

    function readSessionArray(key) {
        try {
            const value = JSON.parse(sessionStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value : [];
        } catch (_) {
            return [];
        }
    }

    function saveSessionValue(key, value) {
        try { sessionStorage.setItem(key, value); } catch (_) { /* métrica anónima no requiere almacenamiento local */ }
    }

    function postMetric(path, body, useBeacon = false) {
        const payload = JSON.stringify(body);
        if (useBeacon && navigator.sendBeacon) {
            navigator.sendBeacon(path, new Blob([payload], { type: 'application/json' }));
            return Promise.resolve(null);
        }
        return fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
            cache: 'no-store'
        }).catch(() => null);
    }

    function setStatus(message, isError = false) {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('is-error', isError);
    }

    function sectionLabel(id) { return labels[id] || id; }

    const emptyStatePlugin = {
        id: 'analyticsDonutLabels',
        afterDatasetsDraw(instance) {
            const values = instance.data.datasets[0]?.data || [];
            const visibleValues = values.map((value, index) => instance.getDataVisibility(index) ? (Number(value) || 0) : 0);
            const visibleTotal = visibleValues.reduce((sum, value) => sum + value, 0);
            const ctx = instance.ctx;
            const area = instance.chartArea;
            if (!area) return;
            const centerX = (area.left + area.right) / 2;
            const centerY = (area.top + area.bottom) / 2;

            if (instance.data.datasets[0]?.emptyPlaceholder) {
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#f8fafc';
                ctx.font = '700 13px Arial, sans-serif';
                ctx.fillText('Esperando visitas', centerX, centerY - 7);
                ctx.fillStyle = '#ddd6fe';
                ctx.font = '600 10px Arial, sans-serif';
                ctx.fillText('Categorías listas · 0 visitas', centerX, centerY + 12);
                ctx.restore();
                return;
            }

            if (!visibleTotal) {
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#f8fafc';
                ctx.font = '700 13px Arial, sans-serif';
                ctx.fillText(values.some((value) => Number(value) > 0) ? 'Activa un apartado' : 'Esperando visitas', centerX, centerY - 7);
                ctx.fillStyle = '#ddd6fe';
                ctx.font = '600 10px Arial, sans-serif';
                ctx.fillText(values.some((value) => Number(value) > 0) ? 'Toca su leyenda para mostrarlo' : 'Los porcentajes aparecerán aquí', centerX, centerY + 12);
                ctx.restore();
                return;
            }

            instance.getDatasetMeta(0).data.forEach((arc, index) => {
                const value = visibleValues[index];
                if (!value) return;
                const share = value / visibleTotal * 100;
                if (share <= 0) return;
                const point = arc.getCenterPoint();
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#1e1038';
                ctx.font = share < 5 ? '700 8px Arial, sans-serif' : (share < 9 ? '700 10px Arial, sans-serif' : '700 12px Arial, sans-serif');
                ctx.fillText(`${share.toFixed(1)}%`, point.x, point.y);
                ctx.restore();
            });

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            ctx.font = '700 23px Arial, sans-serif';
            ctx.fillText(visibleTotal.toLocaleString('es-CO'), centerX, centerY - 7);
            ctx.fillStyle = '#c4b5fd';
            ctx.font = '700 9px Arial, sans-serif';
            ctx.fillText('VISTAS EN APARTADOS', centerX, centerY + 13);
            ctx.restore();
        }
    };

    function makeChartData(data = {}) {
        const sectionData = sectionIds.map((id) => data.sections?.[id] || { views: 0 });
        const actualValues = sectionData.map((item) => Math.max(0, Number(item.views) || 0));
        const hasRealViews = actualValues.some((value) => value > 0);
        // Mantiene visible el gráfico y todas sus categorías incluso antes de recibir visitas.
        // Los segmentos iguales son solo una vista previa visual: no se reportan como visitas.
        const chartValues = hasRealViews ? actualValues : sectionIds.map(() => 1);
        return {
            labels: sectionIds.map(sectionLabel),
            datasets: [{
                data: chartValues,
                actualValues,
                emptyPlaceholder: !hasRealViews,
                backgroundColor: sliceColors,
                borderColor: '#32105b',
                borderWidth: 3,
                hoverBorderColor: '#fff',
                hoverBorderWidth: 2,
                hoverOffset: 9,
                spacing: 2
            }]
        };
    }

    function makeChartOptions() {
        return {
            font: { family: 'Arial, sans-serif', weight: '600' },
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            radius: '92%',
            animation: { duration: 420 },
            interaction: { mode: 'nearest', intersect: true },
            layout: { padding: 8 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(30, 10, 57, .97)',
                    titleColor: '#fff',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(196, 181, 253, .4)',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: { family: 'Arial, sans-serif', weight: '700', size: 13 },
                    bodyFont: { family: 'Arial, sans-serif', weight: '600', size: 12 },
                    callbacks: {
                        title(items) { return items[0]?.label || ''; },
                        label(context) {
                            const dataset = context.chart.data.datasets[0];
                            if (dataset.emptyPlaceholder) return ' Sin visitas registradas todavía';
                            const value = Number(dataset.actualValues?.[context.dataIndex] ?? context.parsed) || 0;
                            const allValues = dataset.actualValues || dataset.data;
                            const visibleTotal = allValues.reduce((sum, item, index) => sum + (context.chart.getDataVisibility(index) ? (Number(item) || 0) : 0), 0);
                            const share = visibleTotal ? value / visibleTotal * 100 : 0;
                            return ` ${value.toLocaleString('es-CO')} vistas · ${share.toFixed(1)}%`;
                        }
                    }
                }
            }
        };
    }

    function initializeChart() {
        if (typeof Chart === 'undefined') {
            setStatus('No se cargó Chart.js. Revisa vendor/chart.min.js.', true);
            return;
        }
        chart = new Chart(canvas, {
            type: 'doughnut',
            data: makeChartData(),
            options: makeChartOptions(),
            plugins: [emptyStatePlugin]
        });
        renderChartLegend();
    }

    function renderChartLegend(data = {}) {
        if (!legendContainer) return;
        const items = sectionIds.map((id) => ({
            label: sectionLabel(id),
            views: Math.max(0, Number(data.sections?.[id]?.views) || 0)
        }));
        const visibleTotal = items.reduce((sum, item, index) => sum + ((chart?.getDataVisibility(index) ?? true) ? item.views : 0), 0);
        legendContainer.replaceChildren();

        items.forEach((item, index) => {
            const isVisible = chart?.getDataVisibility(index) ?? true;
            const itemShare = isVisible && visibleTotal ? item.views / visibleTotal * 100 : 0;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'analytics-chart-legend-item';
            button.setAttribute('aria-pressed', String(isVisible));
            button.setAttribute('aria-label', `${item.label}: ${item.views} vistas, ${itemShare.toFixed(1)} por ciento. Tocar para mostrar u ocultar.`);

            const swatch = document.createElement('span');
            swatch.className = 'analytics-chart-legend-swatch';
            swatch.style.backgroundColor = sliceColors[index];
            swatch.setAttribute('aria-hidden', 'true');

            const name = document.createElement('span');
            name.className = 'analytics-chart-legend-name';
            name.textContent = item.label;

            const metrics = document.createElement('span');
            metrics.className = 'analytics-chart-legend-metrics';
            const percentage = document.createElement('strong');
            percentage.className = 'analytics-chart-legend-percent';
            percentage.textContent = `${itemShare.toFixed(1)}%`;
            const count = document.createElement('small');
            count.textContent = `${item.views.toLocaleString('es-CO')} vistas`;
            metrics.append(percentage, count);
            button.append(swatch, name, metrics);
            button.addEventListener('click', () => {
                chart.toggleDataVisibility(index);
                chart.update();
                renderChartLegend(data);
            });
            legendContainer.append(button);
        });
    }

    function updateChart(data) {
        if (!chart) return;
        chart.data = makeChartData(data);
        chart.update('none');
        renderChartLegend(data);
    }

    function updateSummary(data) {
        document.getElementById('analytics-total-visits').textContent = Number(data.todayVisits || 0).toLocaleString('es-CO');
        document.getElementById('analytics-total-likes').textContent = Number(data.likes || 0).toLocaleString('es-CO');
        document.getElementById('analytics-total-dislikes').textContent = Number(data.dislikes || 0).toLocaleString('es-CO');
    }

    async function loadMetrics() {
        try {
            const response = await fetch('/api/analytics', { cache: 'no-store' });
            if (!response.ok) throw new Error('El servidor de analítica no está activo. Inícialo con npm run start:analytics.');
            const data = await response.json();
            updateSummary(data);
            updateChart(data);
            const updated = new Date(data.updatedAt || Date.now());
            const time = updated.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            setStatus(`En vivo · Actualizado a las ${time} · Sincroniza cada 3 s.`);
        } catch (error) {
            setStatus('La gráfica está lista; para ver y acumular visitas reales, ejecuta npm run start:analytics.', true);
        }
    }

    function reportSectionView(id) {
        if (seen.has(id)) return;
        seen.add(id);
        saveSessionValue(seenKey, JSON.stringify([...seen]));
        postMetric('/api/section-view', { sessionId, section: id });
    }

    function flushActiveTime(force = false, useBeacon = false) {
        if (!currentSection || !sectionStartedAt) return;
        const now = Date.now();
        if (document.hidden && !force) {
            sectionStartedAt = now;
            return;
        }
        const seconds = Math.min(30, Math.max(0, (now - sectionStartedAt) / 1000));
        sectionStartedAt = now;
        if (seconds < 1) return;
        postMetric('/api/section-time', {
            sessionId,
            section: currentSection,
            seconds: Math.round(seconds * 10) / 10
        }, useBeacon);
    }

    function setCurrentSection(id) {
        if (currentSection === id) return;
        if (currentSection) flushActiveTime();
        currentSection = id;
        sectionStartedAt = Date.now();
        reportSectionView(id);
    }

    async function startTracking() {
        initializeChart();
        const observer = new IntersectionObserver((entries) => {
            const visible = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (visible) setCurrentSection(visible.target.id);
        }, { threshold: [0.2, 0.4, 0.65] });

        sectionIds.forEach((id) => {
            const section = document.getElementById(id);
            if (section) observer.observe(section);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) flushActiveTime(true);
            else sectionStartedAt = Date.now();
        });
        window.addEventListener('pagehide', () => flushActiveTime(true, true));

        // Primero se registra la visita y después se consulta el agregado, evitando mostrar un total atrasado.
        await postMetric('/api/visit', { sessionId });
        await loadMetrics();

        window.setInterval(() => {
            if (document.hidden) return;
            flushActiveTime();
            loadMetrics();
        }, refreshEveryMs);
    }

    function initReactionButtons() {
        let savedReaction = null;
        try { savedReaction = sessionStorage.getItem('ed-analytics-reaction'); } catch (_) { /* opcional */ }
        if (savedReaction) setReaction(savedReaction, 'Gracias por compartir tu opinión. Tu reacción ya quedó registrada en esta visita.');

        reactionButtons.forEach((button) => button.addEventListener('click', async () => {
            let alreadyVoted = false;
            try { alreadyVoted = Boolean(sessionStorage.getItem('ed-analytics-reaction')); } catch (_) { /* sigue con la solicitud */ }
            if (alreadyVoted) return;

            const choice = button.dataset.reaction;
            reactionButtons.forEach((item) => { item.disabled = true; });
            try {
                const response = await postMetric('/api/reaction', { sessionId, reaction: choice });
                if (!response?.ok) throw new Error('No se pudo guardar la reacción. Confirma que el servidor de analítica esté activo.');
                saveSessionValue('ed-analytics-reaction', choice);
                setReaction(choice, '¡Gracias! Tu reacción quedó registrada de forma anónima.');
                await loadMetrics();
            } catch (error) {
                reactionButtons.forEach((item) => { item.disabled = false; });
                if (reactionStatus) reactionStatus.textContent = error.message;
            }
        }));
    }

    function setReaction(choice, message) {
        reactionButtons.forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.reaction === choice));
            button.disabled = true;
        });
        if (reactionStatus) reactionStatus.textContent = message;
    }

    initReactionButtons();
    startTracking();
})();
