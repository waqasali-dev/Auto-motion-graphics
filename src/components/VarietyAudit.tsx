// src/components/VarietyAudit.tsx
// Shows the variety plan for the whole film: the verdict, family swimlanes,
// act coverage, the planner's reasons per shot, and the consistency kit.

import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Family, VarietyReport } from "../sdk/contract";
import { ACT_INFO, ACT_ORDER, ARCHETYPE_META, FAMILY_INFO } from "../variety/taxonomy";

const FAMILIES = Object.keys(FAMILY_INFO) as Family[];

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-rule)] bg-white p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[color:var(--color-ink-soft)]">{label}</div>
      <div className="text-2xl md:text-3xl font-bold tabular-nums text-[color:var(--color-ink)] mt-1">{value}</div>
      <div className="text-[11px] text-[color:var(--color-ink-soft)] mt-0.5">{sub}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[color:var(--color-rule)] bg-white p-5 md:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--color-ink-soft)] mb-4">{title}</div>
      {children}
    </div>
  );
}

export function VarietyAudit({ report }: { report: VarietyReport }) {
  const n = report.shots.length;
  const passed = report.violations.length === 0;
  const shotCols = `minmax(0, 1fr)`;

  return (
    <div className="space-y-6">
      {/* Verdict */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="variety score" value={`${report.score}`} sub="out of 100" />
        <Stat label="grammars used" value={`${report.distinctArchetypes} / ${n}`} sub="no archetype twice in a row" />
        <Stat label="families used" value={`${report.distinctFamilies} / ${FAMILIES.length}`} sub="graphs, mesh, investigation…" />
        <Stat
          label="dark shots"
          value={`${report.darkCount} / ${report.darkCap}`}
          sub={`cap ${Math.round(report.policy.maxDarkShare * 100)}% of the film`}
        />
        <Stat label="longest run" value={`${report.maxFamilyRun}`} sub={`same family, limit ${report.policy.maxFamilyRun}`} />
      </div>

      <div
        className={`rounded-2xl border px-5 py-4 flex flex-wrap items-center justify-between gap-3 ${
          passed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
        }`}
      >
        <span className={`font-semibold ${passed ? "text-emerald-700" : "text-red-700"}`}>
          {passed ? "All planner rules satisfied" : `${report.violations.length} planner rule(s) broken`}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
          {report.relaxed ? "search relaxed the repeat window" : `repeat window of ${report.policy.repeatWindow} shots held`}
        </span>
      </div>
      {!passed && (
        <ul className="list-disc pl-6 text-sm text-red-700">
          {report.violations.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}

      {/* Swimlanes */}
      <Panel title="Family swimlanes · one column per shot">
        <div className="overflow-x-auto">
          <div
            className="grid gap-y-1.5 min-w-[720px]"
            style={{ gridTemplateColumns: `11rem repeat(${n}, ${shotCols})` }}
          >
            <div />
            {report.shots.map((s) => (
              <div key={`h-${s.shotId}`} className="font-mono text-[10px] text-center text-[color:var(--color-ink-soft)]">
                {s.index + 1}
              </div>
            ))}

            {FAMILIES.map((f) => (
              <Fragment key={f}>
                <div className="flex items-center gap-2 pr-3">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: FAMILY_INFO[f].color }} />
                  <span className="text-xs font-semibold text-[color:var(--color-ink)] truncate">{FAMILY_INFO[f].label}</span>
                  <span className="ml-auto font-mono text-[10px] text-[color:var(--color-ink-soft)]">{report.familyCounts[f]}</span>
                </div>
                {report.shots.map((s) => (
                  <div key={`${f}-${s.shotId}`} className="h-6 flex items-center justify-center px-px">
                    <div
                      className="w-full h-full rounded-md"
                      style={{
                        background: s.family === f ? FAMILY_INFO[f].color : "rgba(17,24,39,0.05)",
                        opacity: s.family === f ? 1 : 1,
                      }}
                      title={`${s.shotId} · ${s.archetype}`}
                    />
                  </div>
                ))}
              </Fragment>
            ))}

            <div className="flex items-center pr-3 font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink-soft)] pt-2">
              acts
            </div>
            {ACT_ORDER.map((act) => {
              const count = report.shots.filter((s) => s.act === act).length;
              if (count === 0) return null;
              return (
                <div
                  key={`act-${act}`}
                  className="pt-2 font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink)] border-l border-[color:var(--color-rule)] pl-2 truncate"
                  style={{ gridColumn: `span ${count}` }}
                >
                  {ACT_INFO[act].roman} · {ACT_INFO[act].label}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      {/* Act coverage + families */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Act arc · what each act must show">
          <div className="space-y-4">
            {ACT_ORDER.map((act) => {
              const fams = report.actCoverage[act];
              return (
                <div key={act} className="flex items-start gap-4">
                  <div className="w-24 flex-shrink-0">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                      Act {ACT_INFO[act].roman}
                    </div>
                    <div className="text-sm font-semibold text-[color:var(--color-ink)]">{ACT_INFO[act].label}</div>
                    <div className="font-mono text-[10px] text-[color:var(--color-ink-soft)]">energy {ACT_INFO[act].energy}/3</div>
                  </div>
                  <div className="flex-1">
                    <div className="text-xs text-[color:var(--color-ink-soft)] mb-2">{ACT_INFO[act].goal}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {fams.map((f) => (
                        <span
                          key={f}
                          className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-widest text-white"
                          style={{ background: FAMILY_INFO[f].color }}
                        >
                          {FAMILY_INFO[f].label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Families · purpose and members">
          <div className="space-y-4">
            {FAMILIES.map((f) => (
              <div key={f} className="flex items-start gap-3">
                <span className="mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: FAMILY_INFO[f].color }} />
                <div>
                  <div className="text-sm font-semibold text-[color:var(--color-ink)]">
                    {FAMILY_INFO[f].label} <span className="font-mono text-[10px] text-[color:var(--color-ink-soft)]">· {report.familyCounts[f]} shots</span>
                  </div>
                  <div className="text-xs text-[color:var(--color-ink-soft)] leading-relaxed">{FAMILY_INFO[f].purpose}</div>
                  <div className="font-mono text-[10px] text-[color:var(--color-ink-soft)] mt-1 leading-relaxed">
                    {(Object.keys(ARCHETYPE_META) as (keyof typeof ARCHETYPE_META)[])
                      .filter((a) => ARCHETYPE_META[a].family === f)
                      .join(" · ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Shot roster with reasons */}
      <Panel title="Shot roster · why each grammar was chosen">
        <div className="divide-y divide-[color:var(--color-rule)]">
          {report.shots.map((s) => (
            <div key={s.shotId} className="py-3 grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-start">
              <div className="md:col-span-3 flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-[color:var(--color-ink)]">{s.shotId}</span>
                <span className="w-2 h-2 rounded-full" style={{ background: FAMILY_INFO[s.family].color }} />
                <span className="text-sm font-semibold text-[color:var(--color-ink)] truncate">{s.archetype}</span>
              </div>
              <div className="md:col-span-2 font-mono text-[10px] uppercase tracking-widest text-[color:var(--color-ink-soft)]">
                {ACT_INFO[s.act].label} · {s.mode}
              </div>
              <div className="md:col-span-7 font-mono text-[11px] text-[color:var(--color-ink-soft)] leading-relaxed">
                {s.reasons.join("  ·  ")}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
