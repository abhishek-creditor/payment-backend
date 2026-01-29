const path = require("path");
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
require("dotenv").config({ path: path.resolve(__dirname, "../", envFile) });

const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Payment service running on port ${PORT}`);
});
