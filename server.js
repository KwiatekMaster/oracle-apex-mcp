import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

const TOKEN_URL = "https://zistvuimo5abwyl-microcrmdb.adb.eu-zurich-1.oraclecloudapps.com/ords/wksp_microcrm/oauth/token";
const PRODUCTS_URL = "https://zistvuimo5abwyl-microcrmdb.adb.eu-zurich-1.oraclecloudapps.com/ords/wksp_microcrm/ali_products/get";

app.use((req, res, next) => {
  console.log(` ${req.method} ${req.path} [Auth: ${req.headers.authorization ? 'v' : 'x'}]`);
  next();
});


// Uzyskaj token z Oracle APEX
async function getAccessToken() {
  const basicAuth = Buffer.from(`${process.env.APEX_USERNAME}:${process.env.APEX_PASSWORD}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.access_token;
}

// Pobierz produkty z Oracle REST API
async function fetchProducts(token) {
  const res = await fetch(PRODUCTS_URL, {
    headers: { "Authorization": `Bearer ${token}` }
  });

  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();

  return data.items.map(item => {
    const dane = JSON.parse(item.dane_produktu);
    return {
      nazwa: dane.nazwa,
      ocena: dane.ocena,
      cena: dane.cena,
      liczba_sprzedanych: dane.liczba_sprzedanych,
      url: item.url
    };
  });
}

app.get("/sse/tools/list", (req, res) => {
  res.json({
    tools: [
      {
        name: "getOracleProducts",
        description: "Pobiera listę produktów z Oracle APEX (wymaga autoryzacji Bearer).",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "object",
          properties: {
            products: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nazwa: { type: "string" },
                  ocena: { type: "string" },
                  cena: { type: "string" },
                  liczba_sprzedanych: { type: "string" },
                  url: { type: "string" }
                }
              }
            }
          },
          required: ["products"]
        }
      }
    ],
    auth: {
      type: "bearer",
      header: "Authorization",
      prefix: "Bearer"
    }
  });
});


// --- MCP: Wywołanie narzędzia (z autoryzacją) ---
app.post("/sse/tools/call", async (req, res) => {
  try {
    // Sprawdzenie nagłówka autoryzacji
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing Bearer token." });
    }

    const token = authHeader.split(" ")[1];
    if (token !== process.env.MCP_API_KEY) {
      return res.status(403).json({ error: "Forbidden: Invalid API key." });
    }

    // Po autoryzacji – pobranie danych z Oracle APEX
    const apexToken = await getAccessToken();
    const products = await fetchProducts(apexToken);

    // Zwrócenie wyników
    res.json({ success: true, products });
  } catch (err) {
    console.error("MCP Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- MCP: Endpoint diagnostyczny ---
app.all("/mcp/debug", (req, res) => {
  const authHeader = req.headers["authorization"] || "brak nagłówka Authorization";
  const origin = req.headers["origin"] || "brak nagłówka Origin";
  const method = req.method;
  const contentType = req.headers["content-type"] || "brak Content-Type";

  res.json({
    message: "MCP Debug Endpoint działa poprawnie.",
    method,
    origin,
    contentType,
    authorization_header: authHeader,
    headers: req.headers,
    note: "Sprawdź, czy Authorization zawiera Twój Bearer token (np. 'Bearer supersekretnyklucz123')."
  });
});


app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});
