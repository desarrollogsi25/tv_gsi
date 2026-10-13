// ═══════════════════════════════════════════════════════════
// Nexus TV Enterprise — Scheduled Maintenance Tasks (Cron)
// ═══════════════════════════════════════════════════════════

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { pool, mediaDirectory } = require('../config/db');

function initCronJobs() {
    console.log('⏰ [Cron Service] Inicializando tareas programadas de Nexus TV...');

    // Tarea 1: Ejecutar cada 15 minutos para auditar pantallas inactivas
    cron.schedule('*/15 * * * *', async () => {
        try {
            const query = `
                SELECT count(*) FROM nexus_tv.tv_screens 
                WHERE is_active = true 
                  AND (last_login IS NULL OR last_login < NOW() - INTERVAL '10 minutes');
            `;
            const res = await pool.query(query);
            const inactiveCount = res.rows[0].count;
            if (parseInt(inactiveCount, 10) > 0) {
                console.log(`ℹ️ [Cron Audit] ${inactiveCount} pantallas activas no han reportado actividad en los últimos 10 min.`);
            }
        } catch (err) {
            console.error('⚠️ [Cron Error] Fallo al auditar pantallas:', err.message);
        }
    });

    // Tarea 2: Limpieza de archivos de media huérfanos a las 3:00 AM diario
    cron.schedule('0 3 * * *', async () => {
        console.log('🧹 [Cron Cleanup] Verificando archivos huérfanos en directorio de medios...');
        try {
            if (!fs.existsSync(mediaDirectory)) return;

            const dbFilesRes = await pool.query("SELECT source_url FROM nexus_tv.content WHERE source_type = 'local_file'");
            const activeFiles = new Set(dbFilesRes.rows.map(r => path.basename(r.source_url)));

            const diskFiles = fs.readdirSync(mediaDirectory);
            let cleaned = 0;

            for (const file of diskFiles) {
                if (!activeFiles.has(file)) {
                    const fullPath = path.join(mediaDirectory, file);
                    try {
                        const stats = fs.statSync(fullPath);
                        const oneHourAgo = Date.now() - (60 * 60 * 1000);
                        // Solo eliminar si el archivo tiene más de 1 hora de haber sido creado/modificado
                        if (stats.mtimeMs < oneHourAgo) {
                            fs.unlinkSync(fullPath);
                            cleaned++;
                        }
                    } catch (e) {}
                }
            }

            if (cleaned > 0) {
                console.log(`✅ [Cron Cleanup] ${cleaned} archivos huérfanos eliminados.`);
            }
        } catch (err) {
            console.error('⚠️ [Cron Error] Fallo en limpieza de media:', err.message);
        }
    });
    // Tarea 3: Reconciliación automática periódica de vinculaciones pendientes (cada 1 minuto)
    cron.schedule('* * * * *', async () => {
        try {
            const { reconcilePendingPairings } = require('../routes/admin');
            const expiredCount = await reconcilePendingPairings(pool);
            if (expiredCount > 0) {
                console.log(`🧹 [Cron Reconciliation] ${expiredCount} vinculaciones pendientes vencidas marcadas como expired.`);
            }
        } catch (err) {
            console.error('⚠️ [Cron Error] Fallo en reconciliación de vinculaciones:', err.message);
        }
    });

    // Reconciliación inmediata al arranque para limpiar sesiones huérfanas tras reinicios o caídas
    (async () => {
        try {
            const { reconcilePendingPairings } = require('../routes/admin');
            const count = await reconcilePendingPairings(pool);
            if (count > 0) {
                console.log(`🧹 [Boot Reconciliation] ${count} vinculaciones pendientes vencidas reconciliadas al iniciar.`);
            }
        } catch (err) {
            console.warn('⚠️ [Boot Reconciliation] No se pudo ejecutar reconciliación inicial:', err.message);
        }
    })();
}

module.exports = {
    initCronJobs
};
