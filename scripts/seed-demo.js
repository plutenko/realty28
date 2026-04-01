const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const demoUnits = [
    {
      project_name: "ЖК Тестовый",
      rooms: 1,
      area_m2: 36.8,
      floor: 5,
      price_rub: 5900000,
      orientation: "ЮВ",
      layout_title: "1-к 36.8",
      layout_image_url: "https://placehold.co/800x600/png?text=Layout+1",
      finish_image_url: "https://placehold.co/1280x720/png?text=Finish+1",
    },
    {
      project_name: "ЖК Тестовый",
      rooms: 2,
      area_m2: 54.2,
      floor: 9,
      price_rub: 7900000,
      orientation: "Ю",
      layout_title: "2-к 54.2",
      layout_image_url: "https://placehold.co/800x600/png?text=Layout+2",
      finish_image_url: "https://placehold.co/1280x720/png?text=Finish+2",
    },
  ];

  const { data: units, error: uErr } = await supabase
    .from("units")
    .insert(demoUnits)
    .select("id");

  if (uErr) throw uErr;

  const unitIds = (units ?? []).map((u) => u.id);
  if (unitIds.length < 2) throw new Error("Failed to insert demo units");

  const token = crypto.randomBytes(16).toString("hex");
  const title = "Демо-подборка";

  const { data: collection, error: cErr } = await supabase
    .from("collections")
    .insert({ token, title })
    .select("id")
    .single();

  if (cErr) throw cErr;

  const { error: mErr } = await supabase.from("collection_units").insert(
    unitIds.map((unit_id, idx) => ({
      collection_id: collection.id,
      unit_id,
      sort_order: idx,
    }))
  );

  if (mErr) throw mErr;

  console.log("Created demo units:", unitIds.join(", "));
  console.log("Collection token:", token);
  console.log("Open:", `http://localhost:3000/collections/${token}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

