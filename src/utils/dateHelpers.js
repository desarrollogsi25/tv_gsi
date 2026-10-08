// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Date & Schedule Helpers
// ═══════════════════════════════════════════════════════════

const canonicalDayMap = {
    'lunes': 'lunes',
    'martes': 'martes',
    'miercoles': 'miércoles',
    'miércoles': 'miércoles',
    'jueves': 'jueves',
    'viernes': 'viernes',
    'sabado': 'sábado',
    'sábado': 'sábado',
    'domingo': 'domingo'
};

/**
 * Normaliza y valida un arreglo de días de la semana a sus formas canónicas en español.
 * Si el input no es un arreglo o está vacío, retorna la semana completa de 7 días.
 * 
 * @param {Array<string>|null|undefined} inputDays
 * @returns {Array<string>} Días de la semana normalizados sin duplicados
 */
function normalizeDaysOfWeek(inputDays) {
    if (!Array.isArray(inputDays) || inputDays.length === 0) {
        return ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    }
    const normalized = inputDays.map(d => {
        const clean = String(d).trim().toLowerCase();
        return canonicalDayMap[clean] || clean;
    });
    return Array.from(new Set(normalized));
}

module.exports = {
    canonicalDayMap,
    normalizeDaysOfWeek
};
