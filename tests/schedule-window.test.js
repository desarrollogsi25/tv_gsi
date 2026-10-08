const test = require('node:test');
const assert = require('node:assert');

/**
 * Evalúa la vigencia de un ítem según la cláusula SQL de Nexus TV:
 * ((pc.start_time IS NULL OR pc.end_time IS NULL) OR (LOCALTIME BETWEEN pc.start_time AND pc.end_time))
 */
function isItemActiveInSchedule(item, currentTime) {
    if (!item.start_time || !item.end_time) {
        return true;
    }
    return currentTime >= item.start_time && currentTime <= item.end_time;
}

test('schedule-window - ítems con horario coincidente retornan válidos', () => {
    const item = { id: 1, title: 'Turno Mañana', start_time: '08:00:00', end_time: '12:00:00' };
    const currentTime = '10:30:00';
    assert.strictEqual(isItemActiveInSchedule(item, currentTime), true);
});

test('schedule-window - ítems en los límites exactos retornan válidos', () => {
    const item = { id: 2, title: 'Turno Límite', start_time: '08:00:00', end_time: '12:00:00' };
    assert.strictEqual(isItemActiveInSchedule(item, '08:00:00'), true);
    assert.strictEqual(isItemActiveInSchedule(item, '12:00:00'), true);
});

test('schedule-window - ítems de turnos pasados son excluidos', () => {
    const item = { id: 3, title: 'Turno Mañana Pasado', start_time: '06:00:00', end_time: '09:00:00' };
    const currentTime = '14:00:00';
    assert.strictEqual(isItemActiveInSchedule(item, currentTime), false);
});

test('schedule-window - ítems de turnos futuros son excluidos', () => {
    const item = { id: 4, title: 'Turno Tarde Futuro', start_time: '16:00:00', end_time: '20:00:00' };
    const currentTime = '11:00:00';
    assert.strictEqual(isItemActiveInSchedule(item, currentTime), false);
});

test('schedule-window - ítems sin horario (start_time o end_time null) permanecen activos 24/7', () => {
    const itemNullBoth = { id: 5, title: 'Contenido 24/7', start_time: null, end_time: null };
    const itemNullStart = { id: 6, title: 'Contenido parcial', start_time: null, end_time: '18:00:00' };
    const itemNullEnd = { id: 7, title: 'Contenido parcial', start_time: '08:00:00', end_time: null };

    assert.strictEqual(isItemActiveInSchedule(itemNullBoth, '03:15:00'), true);
    assert.strictEqual(isItemActiveInSchedule(itemNullBoth, '23:59:59'), true);
    assert.strictEqual(isItemActiveInSchedule(itemNullStart, '22:00:00'), true);
    assert.strictEqual(isItemActiveInSchedule(itemNullEnd, '05:00:00'), true);
});
