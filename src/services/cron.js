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
            console.error('⚠️ [Cron Error] Fallo en limpieza programada:', err.message);
        }
    });
}

module.exports = {
    initCronJobs
};
