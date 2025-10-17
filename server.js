import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ============================================
// 🧱 Log Helper
// ============================================
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ============================================
// 🔐 MCP API Key Middleware
// ============================================
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedKey = `Bearer ${process.env.MCP_API_KEY}`;

  if (!authHeader || authHeader !== expectedKey) {
    log(`⚠️ Unauthorized request: ${req.method} ${req.path}`);
    return res.status(401).json({ error: "Unauthorized: Invalid or missing MCP API Key" });
  }
  next();
});

// ============================================
// 🌍 CORS + Logging Middleware
// ============================================
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  log(`${req.method} ${req.path}`);
  next();
});

// ============================================
// 🔹 Oracle APEX API Configuration
// ============================================
const TOKEN_URL = "https://zistvuimo5abwyl-microcrmdb.adb.eu-zurich-1.oraclecloudapps.com/ords/wksp_microcrm/oauth/token";
const PRODUCTS_URL = "https://zistvuimo5abwyl-microcrmdb.adb.eu-zurich-1.oraclecloudapps.com/ords/wksp_microcrm/ali_products/get";

// ============================================
// 🔑 Get OAuth Access Token
// ============================================
async function getAccessToken() {
  const basicAuth = Buffer.from(`${process.env.APEX_USERNAME}:${process.env.APEX_PASSWORD}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const errText = await res.text();
    log(`❌ Error fetching token: ${errText}`);
    throw new Error("Failed to get access token from Oracle APEX");
  }

  const data = await res.json();
  log("🔑 Access token retrieved successfully");
  return data.access_token;
}

// ============================================
// 📦 Fetch Products from Oracle APEX
// ============================================
async function fetchProducts(limit = 5) {
  const token = await getAccessToken();
  const res = await fetch(PRODUCTS_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();

  return data.items.slice(0, limit).map((item) => {
    const dane = JSON.parse(item.dane_produktu);
    return {
      nazwa: dane.nazwa,
      cena: dane.cena,
      ocena: dane.ocena,
    };
  });
}

// ============================================
// ⚙️ MCP: Handshake (SSE) — Agent Builder Fix
// ============================================
app.get("/sse", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  log("🔗 MCP client connected to /sse");

  // 🟢 Ping event to force connection flush (Render + Cloudflare fix)
  res.write(":\n\n");

  setTimeout(() => {
    const tools = [
      {
        name: "fetch_products",
        description: "Pobiera listę produktów z Oracle APEX REST API",
        input_schema: {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              description: "Liczba produktów do pobrania",
              default: 5,
            },
          },
          required: [],
        },
      },
    ];

    const payload = {
      type: "mcp_list_tools",
      tools,
    };

    log("📤 Sent mcp_list_tools to MCP client");
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }, 100);

  req.on("close", () => {
    log("❌ MCP client disconnected from /sse");
  });
});

// ============================================
// 🧠 MCP: Tool Execution Endpoint
// ============================================
app.post("/mcp", async (req, res) => {
  const { type, tool_name, arguments: args } = req.body;
  log(`⚙️ MCP request received: ${type} (${tool_name})`);

  try {
    if (type === "mcp_call" && tool_name === "fetch_products") {
      const result = await fetchProducts(args?.limit || 5);
      log("✅ fetch_products executed successfully");
      return res.json({
        type: "mcp_call_result",
        result,
      });
    }

    if (type === "mcp_list_tools") {
      log("📋 Returned tool list via /mcp");
      return res.json({
        type: "mcp_list_tools",
        tools: [
          {
            name: "fetch_products",
            description: "Pobiera produkty z Oracle APEX API",
          },
        ],
      });
    }

    res.status(400).json({ error: "Unsupported MCP message type" });
  } catch (err) {
    log(`❌ MCP tool error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 🚀 Server Startup
// ============================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => log(`✅ MCP server running on port ${PORT}`));
