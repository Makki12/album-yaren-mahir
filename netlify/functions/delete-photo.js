const https  = require("https");
const crypto = require("crypto");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Geçersiz istek" }) }; }

  const { publicId, deviceId } = body;
  if (!publicId || !deviceId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Eksik parametre" }) };
  }

  const CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
  const API_KEY     = process.env.CLOUDINARY_API_KEY;
  const API_SECRET  = process.env.CLOUDINARY_API_SECRET;

  if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: "Sunucu yapılandırması eksik" }) };
  }

  try {
    const info = await cloudinaryGet(CLOUD_NAME, API_KEY, API_SECRET, publicId);
    const contextRaw = info?.context?.custom || {};
    let storedDeviceId = contextRaw.deviceId || "";
    try { storedDeviceId = decodeURIComponent(storedDeviceId); } catch(e) {}

    if (!storedDeviceId) {
      return { statusCode: 403, body: JSON.stringify({ error: "Bu fotoğraf için cihaz bilgisi bulunamadı." }) };
    }
    if (storedDeviceId.trim() !== deviceId.trim()) {
      return { statusCode: 403, body: JSON.stringify({ error: "Bu fotoğrafı silme yetkiniz yok." }) };
    }

    await cloudinaryDestroy(CLOUD_NAME, API_KEY, API_SECRET, publicId);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: "Silme başarısız: " + e.message }) };
  }
};

function cloudinaryGet(cloudName, apiKey, apiSecret, publicId) {
  const url  = "https://api.cloudinary.com/v1_1/"+cloudName+"/resources/image/upload/"+encodeURIComponent(publicId)+"?context=true";
  const auth = Buffer.from(apiKey+":"+apiSecret).toString("base64");
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { "Authorization": "Basic " + auth } }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.end();
  });
}

function cloudinaryDestroy(cloudName, apiKey, apiSecret, publicId) {
  const timestamp = Math.round(Date.now() / 1000);
  const signature = crypto.createHash("sha1")
    .update("public_id="+publicId+"&timestamp="+timestamp+apiSecret)
    .digest("hex");
  const postData = new URLSearchParams({ public_id: publicId, timestamp, api_key: apiKey, signature }).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(
      "https://api.cloudinary.com/v1_1/"+cloudName+"/image/destroy",
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(postData) } },
      (res) => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => {
          try {
            const j = JSON.parse(d);
            j.result === "ok" ? resolve(j) : reject(new Error(j.result || "Silinemedi"));
          } catch(e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}
