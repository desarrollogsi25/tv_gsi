const test = require('node:test');
const assert = require('node:assert');
const { normalizeDaysOfWeek } = require('../src/utils/dateHelpers');

test('normalizeDaysOfWeek - arreglos con tildes se preservan canónicos', () => {
    const input = ['miércoles', 'sábado'];
    const result = normalizeDaysOfWeek(input);
    assert.deepStrictEqual(result, ['miércoles', 'sábado']);
});

test('normalizeDaysOfWeek - arreglos sin tildes se normalizan a formato canónico con tilde', () => {
    const input = ['miercoles', 'sabado'];
    const result = normalizeDaysOfWeek(input);
    assert.deepStrictEqual(result, ['miércoles', 'sábado']);
});

test('normalizeDaysOfWeek - valores mixtos con mayúsculas y espacios se normalizan', () => {
    const input = [' Lunes ', 'MIERCOLES', 'Sabado '];
    const result = normalizeDaysOfWeek(input);
    assert.deepStrictEqual(result, ['lunes', 'miércoles', 'sábado']);
});

test('normalizeDaysOfWeek - valores nulos o vacíos retornan arreglo completo de 7 días', () => {
    const expected = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

    assert.deepStrictEqual(normalizeDaysOfWeek(null), expected);
    assert.deepStrictEqual(normalizeDaysOfWeek(undefined), expected);
    assert.deepStrictEqual(normalizeDaysOfWeek([]), expected);
    assert.deepStrictEqual(normalizeDaysOfWeek('no-es-array'), expected);
});
