const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cors({ origin: false }));
app.use(morgan("combined"));

module.exports = app;
