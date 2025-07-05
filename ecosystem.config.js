module.exports = {
  apps: [{
    name: 'hamqary',
    script: 'index.js',
    
    // PM2 Clustering
    instances: 1, // Set to 'max' for multiple instances based on CPU cores
    exec_mode: 'fork', // Use 'cluster' for load balancing across multiple instances
    
    // Auto Restart
    autorestart: true,
    watch: false, // Set to true for development to auto-restart on file changes
    max_memory_restart: '1G', // Restart if memory usage exceeds 1GB
    
    // Environment Variables
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Process Management
    kill_timeout: 5000, // Time in ms before force killing
    listen_timeout: 8000, // Time in ms before considering app as online
    reload_delay: 1000, // Delay between restarts
    
    // Advanced Options
    max_restarts: 10, // Maximum number of restarts before giving up
    min_uptime: '10s', // Minimum uptime before considering restart
    
    // Cron restart (optional)
    // cron_restart: '0 0 * * *', // Restart every day at midnight
    
    // Source map support for better debugging
    node_args: '--max-old-space-size=1024',
    
    // Process monitoring
    pmx: true,
    
    // Process shutdown
    shutdown_with_message: true,
    wait_ready: true,
    
    // Custom restart delay on crash
    restart_delay: 4000
  }]
};
