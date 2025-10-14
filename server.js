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

// MCP endpoint: lista narzędzi
app.get("/sse/tools/list", (req, res) => {
  res.json({
    tools: [
      {
        name: "getOracleProducts",
        description: "Pobiera listę produktów z Oracle APEX",
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
                },
                required: ["nazwa", "ocena", "cena", "liczba_sprzedanych", "url"]
              }
            }
          },
          required: ["products"]
        }
      }
    ]
  });
});

// MCP endpoint: wywołanie narzędzia
app.post("/sse/tools/call", async (req, res) => {
  try {
    const token = await getAccessToken();
    const products = await fetchProducts(token);
    res.json({ success: true, products });
  } catch (err) {
    console.error("MCP Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});
