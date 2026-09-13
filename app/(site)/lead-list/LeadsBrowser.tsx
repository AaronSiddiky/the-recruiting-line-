"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

/* ---------- CSV parsing (quotes, escaped quotes, CRLF) ---------- */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/* ---------- Header mapping (Data Axle / generic exports) ---------- */

export interface Lead {
  company: string;
  contact: string;
  title: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  employees: string;
  sales: string;
  industry: string;
  [key: string]: string;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s\-./]+/g, "_").replace(/[^a-z0-9_]/g, "");

// First alias that matches wins; checked in order.
const FIELD_ALIASES: [keyof Lead, string[]][] = [
  ["company", ["company_name", "company", "name", "business_name", "business"]],
  ["phone", ["phone_number_combined", "phone_number", "phone", "telephone"]],
  ["website", ["website", "web_address", "url", "domain"]],
  ["city", ["city"]],
  ["state", ["state", "state_abbreviation", "region"]],
  ["employees", ["location_employee_size_actual", "location_employee_size_range", "employee_size", "employees", "employee_count", "number_of_employees"]],
  ["sales", ["location_sales_volume_range", "location_sales_volume_actual", "corporate_sales_volume", "sales_volume", "annual_revenue", "revenue", "sales"]],
  ["industry", ["primary_sic_description", "primary_naics_description", "sic_description", "naics_description", "industry", "category", "line_of_business"]],
  ["title", ["executive_title", "title", "contact_title"]],
];

function buildLeads(rows: string[][]): Lead[] {
  const headers = rows[0].map(norm);
  const idx: Partial<Record<keyof Lead, number>> = {};
  for (const [field, aliases] of FIELD_ALIASES) {
    for (const a of aliases) {
      const i = headers.indexOf(a);
      if (i !== -1) { idx[field] = i; break; }
    }
  }
  // Contact name: single column, or Data Axle's first+last pair.
  const contactCol = ["executive_name", "contact_name", "contact", "owner", "owners_name", "owner_name"]
    .map(a => headers.indexOf(a)).find(i => i !== -1);
  const firstCol = headers.findIndex(h => ["executive_first_name", "first_name"].includes(h));
  const lastCol = headers.findIndex(h => ["executive_last_name", "last_name"].includes(h));

  return rows.slice(1).map(r => {
    const get = (f: keyof Lead) => (idx[f] !== undefined ? (r[idx[f]!] ?? "").trim() : "");
    let contact = contactCol !== undefined ? (r[contactCol] ?? "").trim() : "";
    if (!contact && (firstCol !== -1 || lastCol !== -1)) {
      contact = [firstCol !== -1 ? r[firstCol] : "", lastCol !== -1 ? r[lastCol] : ""]
        .map(s => (s ?? "").trim()).filter(Boolean).join(" ");
    }
    return {
      company: get("company"), contact, title: get("title"), phone: get("phone"),
      website: get("website"), city: get("city"), state: get("state"),
      employees: get("employees"), sales: get("sales"), industry: get("industry"),
    };
  }).filter(l => l.company);
}

/* ---------- Sorting helpers ---------- */

type SortKey = "company" | "city" | "state" | "employees" | "sales" | "industry";

// "10 to 19" / "$1-2.5 Million" style ranges sort by their first number.
function firstNumber(s: string): number {
  const m = s.replace(/,/g, "").match(/\d+(\.\d+)?/);
  if (!m) return -1;
  let n = parseFloat(m[0]);
  if (/million/i.test(s)) n *= 1_000_000;
  if (/billion/i.test(s)) n *= 1_000_000_000;
  return n;
}

/* ---------- Component ---------- */

const STORAGE_KEY = "trl-leads-csv";

export default function LeadsBrowser() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("employees");
  const [sortDesc, setSortDesc] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { name, text } = JSON.parse(saved);
        const rows = parseCsv(text);
        // localStorage only exists in the browser, so the saved file can only be restored after mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (rows.length > 1) { setLeads(buildLeads(rows)); setFileName(name); }
      }
    } catch { /* fresh start */ }
  }, []);

  function loadFile(file: File) {
    setError(null);
    file.text().then(text => {
      const rows = parseCsv(text);
      if (rows.length < 2) { setError("That file has no data rows."); return; }
      const built = buildLeads(rows);
      if (built.length === 0) {
        setError("No company-name column found. Expected a header like “Company Name”.");
        return;
      }
      setLeads(built);
      setFileName(file.name);
      setSearch(""); setStateFilter(""); setIndustryFilter("");
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: file.name, text })); }
      catch { /* too big for localStorage — still works, just won't survive reload */ }
    });
  }

  function clearAll() {
    setLeads(null); setFileName("");
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  const states = useMemo(
    () => Array.from(new Set((leads ?? []).map(l => l.state).filter(Boolean))).sort(),
    [leads],
  );
  const industries = useMemo(
    () => Array.from(new Set((leads ?? []).map(l => l.industry).filter(Boolean))).sort(),
    [leads],
  );

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = search.trim().toLowerCase();
    const rows = leads.filter(l =>
      (!stateFilter || l.state === stateFilter) &&
      (!industryFilter || l.industry === industryFilter) &&
      (!q || [l.company, l.contact, l.city, l.phone, l.industry].some(v => v.toLowerCase().includes(q)))
    );
    const dir = sortDesc ? -1 : 1;
    const numeric = sortKey === "employees" || sortKey === "sales";
    return [...rows].sort((a, b) => {
      if (numeric) return (firstNumber(a[sortKey]) - firstNumber(b[sortKey])) * dir;
      return a[sortKey].localeCompare(b[sortKey]) * dir;
    });
  }, [leads, search, stateFilter, industryFilter, sortKey, sortDesc]);

  const withPhone = filtered.filter(l => l.phone).length;
  const withContact = filtered.filter(l => l.contact).length;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(key === "employees" || key === "sales"); }
  }

  function downloadFiltered() {
    const cols: (keyof Lead)[] = ["company", "contact", "title", "phone", "website", "city", "state", "employees", "sales", "industry"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [cols.join(","), ...filtered.map(l => cols.map(c => esc(l[c] ?? "")).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "leads-filtered.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDesc ? " ↓" : " ↑") : "");

  return (
    <div className="leads-page">
      <div className="hazard" aria-hidden="true" />
      <nav>
        <div className="nav-in">
          <Link className="logo" href="/">The <span>Recruiting</span> Line</Link>
          <span className="leads-tag">Lead list — internal</span>
        </div>
      </nav>

      <main className="wrap">
        {!leads ? (
          <div
            className={`dropzone${dragOver ? " over" : ""}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) loadFile(f);
            }}
          >
            <span className="eyebrow">Target companies</span>
            <h1 className="dz-title">Drop a CSV of companies.</h1>
            <p className="dz-sub">
              Export a list from Data Axle (Columbia Libraries), or any CSV with a
              company-name column. Parsed in your browser — nothing is uploaded.
            </p>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              Choose a file
            </button>
            {error && <p className="dz-error">{error}</p>}
            <input
              ref={inputRef} type="file" accept=".csv,text/csv" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
            />
          </div>
        ) : (
          <>
            <div className="list-head">
              <div>
                <span className="eyebrow">{fileName}</span>
                <h1 className="list-title">
                  {filtered.length.toLocaleString("en-US")}
                  {filtered.length !== leads.length && ` of ${leads.length.toLocaleString("en-US")}`} companies
                </h1>
              </div>
              <div className="head-actions">
                <button className="btn-small" onClick={downloadFiltered}>Download filtered CSV</button>
                <button className="btn-small" onClick={() => inputRef.current?.click()}>Load another</button>
                <button className="btn-small ghost" onClick={clearAll}>Clear</button>
                <input
                  ref={inputRef} type="file" accept=".csv,text/csv" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
                />
              </div>
            </div>

            <div className="stat-row">
              <div className="tile"><div className="tile-num">{filtered.length.toLocaleString("en-US")}</div><div className="tile-lab">Companies shown</div></div>
              <div className="tile"><div className="tile-num">{states.length}</div><div className="tile-lab">States</div></div>
              <div className="tile"><div className="tile-num">{filtered.length ? Math.round((withPhone / filtered.length) * 100) : 0}%</div><div className="tile-lab">Have a phone</div></div>
              <div className="tile"><div className="tile-num">{filtered.length ? Math.round((withContact / filtered.length) * 100) : 0}%</div><div className="tile-lab">Have a named contact</div></div>
            </div>

            <div className="filters">
              <input
                className="search" type="search" placeholder="Search company, contact, city…"
                value={search} onChange={e => setSearch(e.target.value)}
              />
              <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
                <option value="">All states</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={industryFilter} onChange={e => setIndustryFilter(e.target.value)}>
                <option value="">All industries</option>
                {industries.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("company")}>Company{sortArrow("company")}</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th onClick={() => toggleSort("city")}>City{sortArrow("city")}</th>
                    <th onClick={() => toggleSort("state")}>State{sortArrow("state")}</th>
                    <th onClick={() => toggleSort("employees")}>Employees{sortArrow("employees")}</th>
                    <th onClick={() => toggleSort("sales")}>Sales{sortArrow("sales")}</th>
                    <th onClick={() => toggleSort("industry")}>Industry{sortArrow("industry")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l, i) => (
                    <tr key={i}>
                      <td className="c-company">
                        {l.website
                          ? <a href={/^https?:/i.test(l.website) ? l.website : `https://${l.website}`} target="_blank" rel="noreferrer">{l.company}</a>
                          : l.company}
                      </td>
                      <td>{l.contact}{l.title && <span className="c-title"> — {l.title}</span>}</td>
                      <td className="c-mono">{l.phone && <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a>}</td>
                      <td>{l.city}</td>
                      <td className="c-mono">{l.state}</td>
                      <td className="c-mono">{l.employees}</td>
                      <td className="c-mono">{l.sales}</td>
                      <td className="c-industry">{l.industry}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && <p className="empty">Nothing matches those filters.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
