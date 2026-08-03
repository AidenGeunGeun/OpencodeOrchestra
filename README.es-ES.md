

<div align="center">

[![OpenCodeOrchestra](.github/assets/hero.png)](https://github.com/AidenGeunGeun/OpencodeOrchestra)

# OpenCodeOrchestra

**Tu agente de IA no necesita 15 herramientas. Necesita un equipo.**

PM planifica. Orchestrator ejecuta. Los especialistas investigan, revisan, indagan y documentan.<br/>
Cada rol tiene su propia profundidad, permisos y modelo. Como un equipo de ingeniería real.

[![GitHub Release](https://img.shields.io/github/v/release/AidenGeunGeun/OpencodeOrchestra?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases)
[![GitHub Stars](https://img.shields.io/github/stars/AidenGeunGeun/OpencodeOrchestra?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/AidenGeunGeun/OpencodeOrchestra/stargazers)
[![License](https://img.shields.io/badge/license-MIT-white?labelColor=black&style=flat-square)](LICENSE)

Un fork de [OpenCode](https://github.com/AnomalyCo/opencode) v1.2.5 · AI SDK 6.x 

</div>

---

## Instalación en 30 segundos

**Descargas de versiones por plataforma**

| Plataforma | Descarga recomendada |
| --- | --- |
| macOS | Desktop `.dmg` |
| Ubuntu / Debian | Desktop `.deb` |
| Fedora / RHEL | Desktop `.rpm` |
| Windows | CLI `.zip` |
| Linux terminal-only | CLI `.tar.gz` |

> [!TIP]
> **Para Agentes** — pega esto en tu agente LLM (Claude Code, OpenCode, Cursor, etc.):
> ```
> Instala y configura OpenCodeOrchestra siguiendo las instrucciones aquí:
> https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/docs/installation.md
> ```

**Para Humanos** — copia, pega, ejecuta:

```bash
# Download the latest binary from GitHub Releases, put it on your PATH
# macOS: codesign -f -s - ~/.local/bin/oco

mkdir -p \
  ~/.config/oco/prompts \
  ~/.config/oco/skills/agents-md/references \
  ~/.config/oco/skills/skill-creator/references

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/oco.jsonc -o ~/.config/oco/oco.jsonc
for f in pm orchestrator investigator auditor web-search docs compaction; do
  curl -fsSL "https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/prompts/${f}.txt" -o ~/.config/oco/prompts/${f}.txt
done

curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/SKILL.md -o ~/.config/oco/skills/agents-md/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/examples.md -o ~/.config/oco/skills/agents-md/references/examples.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/agents-md/references/detection-patterns.md -o ~/.config/oco/skills/agents-md/references/detection-patterns.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/SKILL.md -o ~/.config/oco/skills/skill-creator/SKILL.md
curl -fsSL https://raw.githubusercontent.com/AidenGeunGeun/OpencodeOrchestra/main/config/skills/skill-creator/references/schemas.md -o ~/.config/oco/skills/skill-creator/references/schemas.md

oco auth login
oco
```

Eso es todo. Tienes un PM, un Orchestrator y cuatro agentes especialistas. [Guía completa de configuración →](docs/installation.md)

Si ya tienes una instalación anterior de `~/.config/opencode/`, el nuevo binario la leerá como respaldo hasta que migres. Ejecuta `scripts/migrate-config.sh` para copiar los archivos de configuración, prompts, estado y caché faltantes al nuevo espacio de nombres `oco` y duplicar `opencode.jsonc` / `opencode.json` como `oco.jsonc` / `oco.json`.

### Actualización

OCO no se actualiza automáticamente. Para actualizar, consulta [GitHub Releases](https://github.com/AidenGeunGeun/OpencodeOrchestra/releases), descarga la última versión para tu plataforma y reinstálala usando los mismos pasos que en la instalación inicial.

---

## El Problema

OpenCode Vanilla tiene dos agentes: `build` y `plan`. Comparten todo: contexto, permisos, herramientas. Tú das el prompt, él codifica, tú te conformas con esperar lo mejor.

Eso funciona para tareas pequeñas. Se desmorona cuando necesitas cambios en múltiples archivos, decisiones de arquitectura o cualquier cosa donde "la IA se salió de los rieles" signifique horas de reabajo.

Muchas personas añaden agentes específicos para roles con "personas expertas". Sin embargo, en lugar de eso, OpenCodeOrchestra sugiere primitivas de agente; no definimos al agente por sus trabajos, sino que lo separamos por roles de subagentes que pueden ser primitivas para cualquier tarea. Esto nos permite tener un conjunto mínimo de subagentes capaces, en lugar de añadir docenas de configuraciones diferentes de subagentes que son confusas y saturan el contexto.

## La Solución

OCO divide el trabajo de la manera que lo haría un equipo real:

```text
You
 │
 ▼
PM (Depth 0) ─── talks to you, investigates, drafts specs
 │
 ├──▶ Orchestrator (Depth 1) ─── executes the approved spec
 │         │
 │         ├──▶ Investigator ─── reads code, traces calls, reports facts
 │         ├──▶ Auditor ─── reviews changes, returns PASS or FAIL
 │         ├──▶ Web-Search ─── fetches info from the web
 │         └──▶ Docs ─── updates documentation
 │
 ▼
You review, approve, or redirect
```

El PM no escribe código. El Orchestrator no habla contigo. El Investigator no puede editar archivos. Cada agente hace una sola cosa, acotada a su nivel de profundidad.

---

## Cómo Funciona

| Paso | Qué sucede |
|:-----|:-------------|
| **1** | Le describes al PM lo que quieres |
| **2** | El PM investiga la base de código y redacta una especificación |
| **3** | Aprobas (o ajustas) la especificación |
| **4** | El PM transfiere el control al Orchestrator |
| **5** | El Orchestrator implementa mediante subagentes especializados |
| **6** | El Auditor revisa el conjunto completo de cambios — PASS o FAIL |
| **7** | El Orchestrator llama a `handoff_to_pm` para devolver el control al PM |
| **8** | El PM informa los resultados y acciones posteriores |

Nada de "simplemente ve e implementa esto" en formato libre. Primero la especificación, puerta de aprobación, ciclo de auditoría, transferencia limpia.

---

## Agentes

<table>
<tr>
<td align="center"><img src=".github/assets/icon-pm.png" height="200" /><br/><b>PM</b></td>
<td align="center"><img src=".github/assets/icon-orch.png" height="200" /><br/><b>Orchestrator</b></td>
<td align="center"><img src=".github/assets/icon-investigator.png" height="200" /><br/><b>Investigator</b></td>
<td align="center"><img src=".github/assets/icon-auditor.png" height="200" /><br/><b>Auditor</b></td>
<td align="center"><img src=".github/assets/icon-web-search.png" height="200" /><br/><b>Web-Search</b></td>
<td align="center"><img src=".github/assets/icon-docs.png" height="200" /><br/><b>Docs</b></td>
</tr>
</table>

| Agente | Profundidad | Modelo predeterminado | Recomendado | Qué hace | Restricción |
|:------|:-----:|:--------------|:------------|:-------------|:-----------|
| **PM** (`build` / `plan`) | 0 | GPT-5.4 | Modelo pesado (GPT-5.4, Claude Opus) | Habla contigo. Investiga, planifica, redacta especificaciones, delega. | Debe obtener tu aprobación antes de ejecutar |
| **Orchestrator** | 1 | GPT-5.4 | Modelo pesado (GPT-5.4, Claude Opus) | Ejecuta la especificación aprobada. Genera subagentes. Ejecuta el ciclo de auditoría. | Debe llamar a `handoff_to_pm` para devolver el control |
| **Investigator** | 2+ | GPT-5.4 mini | Modelo rápido (GPT-5.4 mini, Claude Sonnet) | Lee código, rastrea cadenas de llamadas, cruza referencias de archivos. | Solo lectura. Sin edición, sin shell. |
| **Auditor** | 2+ | GPT-5.4 | Modelo pesado (GPT-5.4, Claude Sonnet) | Revisa los cambios contra la especificación. Veredicto PASS/FAIL. | Solo lectura. Sin edición, sin shell. |
| **Web-Search** | 2+ | GPT-5.4 mini | Modelo rápido (GPT-5.4 mini, Claude Sonnet) | Busca en la web y devuelve evidencia con citas de fuente. | Solo lectura. Sin edición. |
| **Docs** | 2+ | GPT-5.4 mini | Modelo rápido (GPT-5.4 mini, Claude Sonnet) | Actualiza el README, documentación y referencias de API. | Solo ámbito de documentación. |

> [!NOTE]
> La configuración incluida establece **OpenAI** como predeterminada para cada agente.<br/>
> PM, Orchestrator y Auditor usan **GPT-5.4**; Investigator, Web-Search, Docs y Compaction usan **GPT-5.4 mini**. Claude sigue siendo una opción compatible si lo prefieres. Consulta [personalización →](docs/customization.md)

---

## Qué Lo Hace Diferente

|  | OpenCode Vanilla | OCO |
|:--|:-----------------|:----|
| Estructura de agentes | Plana: dos agentes comparten todo | **Jerárquica** — PM → Orchestrator → Subagentes |
| Antes de ejecutar | Nada | **Puerta de aprobación de especificación** |
| Revisión de código | Esperar que el modelo se revise a sí mismo | **Auditor dedicado** con PASS/FAIL |
| Aplicación de profundidad | Ninguna | **Aplicada en tiempo de ejecución** — los agentes no pueden escapar de su nivel |
| Transferencia de ejecución | Entrada/salida única | **Mensaje de orientación `handoff_to_pm` duradero** con resumen |
| AI SDK | 5.x | **6.x** con pensamiento adaptativo de Claude 4.6 |

---

## Documentación

| Documento | Qué contiene |
|:----|:-------------|
| **[Instalación](docs/installation.md)** | Configuración desde cero hasta funcionamiento — seguible por agentes y legible para humanos |
| **[Arquitectura](docs/architecture.md)** | Por qué existe la jerarquía, modelo de profundidad, flujo de especificación, ciclo de auditoría |
| **[Agentes](docs/agents.md)** | El rol, modelo, permisos y diseño de prompt de cada agente |
| **[Personalización](docs/customization.md)** | Intercambio de modelos, plugins, MCPs y recetas para diferentes configuraciones |
| **[Diferencia con el proyecto original](UPSTREAM-DIFF.md)** | Divergencia a nivel de código respecto a OpenCode 1.2.5 |

---

## Compilar Desde el Código Fuente

```bash
git clone https://github.com/AidenGeunGeun/OpencodeOrchestra.git
cd OpencodeOrchestra && bun install
cd packages/opencode && bun run build --single --skip-install
# Binary: dist/@skybluejacket/oco-<platform>-<arch>/bin/oco
```

Requiere [Bun](https://bun.sh). Los binarios de macOS deben tener firma ad-hoc: `codesign -f -s - ./oco`

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para el flujo de trabajo de desarrollo.

---

<div align="center">

La configuración y los prompts se distribuyen en `config/` — adiós a las configuraciones de agente que "funcionaban en mi máquina".

**[Comienza aquí →](docs/installation.md)**

</div>
