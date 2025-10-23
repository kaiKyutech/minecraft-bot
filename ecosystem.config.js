module.exports = {
  apps: []
}

// 100体のBotを動的に生成
for (let i = 1; i <= 100; i++) {
  module.exports.apps.push({
    name: `Bot${i}`,
    script: 'planner_bot/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: {
      MC_USERNAME: `Bot${i}`,
      MC_HOST: 'localhost',
      MC_PORT: 25565,
      CAMERA_COUNT: 0,
      AI_BOT_COUNT: 1,
      MC_VERSION: ''
    },
    error_file: `logs/bot${i}-error.log`,
    out_file: `logs/bot${i}-out.log`,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: false  // 自動再起動しない
  })
}
