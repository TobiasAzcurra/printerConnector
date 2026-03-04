module.exports = {
  apps: [
    {
      name: "printer-web",
      script: "web/server.js",
      watch: false,
      restart_delay: 2000,
    },
    {
      name: "printer-connector",
      script: "index.js",
      watch: false,
      restart_delay: 2000,
    },
  ],
};
