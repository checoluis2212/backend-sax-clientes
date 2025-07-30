const API_BASE = import.meta.env.VITE_API_URL || 'https://clientes.saxmexico.com';

export async function createEstudio(payload) {
  const url = `${API_BASE}/api/estudios`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error ${res.status}: ${text}`);
  }
  return res.json(); // { ok, docId, cvUrl }
}

export async function crearCheckout(datos) {
  const url = `${API_BASE}/api/checkout`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error ${res.status}: ${text}`);
  }
  return res.json(); // { checkoutUrl }
}
