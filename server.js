import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ============================================
// 🔐 Global middleware — autoryzacja przez MCP_API_KEY
// ============================================
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedKey = `Bearer ${process.env.MCP_API_KEY}`;
  if (!authHeader || authHeader !== expectedKey) {
    console.warn("⚠️ Unauthorized request:", req.method, req.path);
    return res.status(401).json({ error: "Unauthorized: Invalid or missing MCP API Key" });
  }
  next();
});

// ============================================
// 🌍 CORS i logowanie
// ============================================
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ============================================
// 🔹 Stałe dla Oracle APEX REST API
// ============================================
const TOKEN_URL = "https://zistvuimo5abwyl-microcrmdb.adb.eu-zurich-1.oraclecloudapps.com/ords/wksp_microcrm/oauth/token";
const PRODUCTS_URL = "https://zistvuimo5abwyl-microcrmdb.adb.eu-zurich-1.oraclecloudapps.com/ords/wksp_microcrm/ali_products/get";

// ============================================
// 🔑 Funkcja pomocnicza: uzyskanie tokenu OAuth
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
    console.error("❌ Error fetching token:", await res.text());
    throw new Error("Failed to get access token from Oracle APEX");
  }

  const data = await res.json();
  return data.access_token;
}

// ============================================
// 📦 Funkcja: pobierz produkty z APEX REST API
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
// ⚙️ MCP: lista narzędzi (handshake /sse)
// ============================================
app.get("/sse", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  console.log("🔗 MCP client connected to /sse");

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

  res.write(`data: ${JSON.stringify(payload)}\n\n`);

  req.on("close", () => {
    console.log("❌ MCP client disconnected");
  });
});

// ============================================
// 🧠 MCP: obsługa wywołań narzędzi (POST /mcp)
// ============================================
app.post("/mcp", async (req, res) => {
  const { type, tool_name, arguments: args } = req.body;
  console.log(`⚙️ MCP request: ${type} (${tool_name})`);

  try {
    if (type === "mcp_call" && tool_name === "fetch_products") {
      const result = await fetchProducts(args?.limit || 5);
      return res.json({
        type: "mcp_call_result",
        result,
      });
    }

    if (type === "mcp_list_tools") {
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
    console.error("❌ MCP tool error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 🚀 Start serwera (Render przypisuje port przez env.PORT)
// ============================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ MCP server running on port ${PORT}`));
