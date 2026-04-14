import { useMemo, useRef, useState } from 'react'
import './App.css'


const INITIAL_TRIALS = 2

let embeddedExportFontCssPromise = null

function emptyRow(trialCount) {
  return {
    independent: '',
    trials: Array.from({ length: trialCount }, () => ''),
  }
}

function parseNumber(value) {
  const num = Number.parseFloat(value)
  return Number.isFinite(num) ? num : null
}

function sampleStandardDeviation(values) {
  if (values.length < 2) {
    return 0
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1)
  return Math.sqrt(variance)
}

function linearRegression(points) {
  if (points.length < 2) {
    return null
  }

  const n = points.length
  const sumX = points.reduce((sum, point) => sum + point.x, 0)
  const sumY = points.reduce((sum, point) => sum + point.y, 0)
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0)
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0)
  const denominator = n * sumXX - sumX * sumX

  if (Math.abs(denominator) < Number.EPSILON) {
    return null
  }

  const slope = (n * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / n
  const meanY = sumY / n
  const ssRes = points.reduce((sum, point) => {
    const residual = point.y - (slope * point.x + intercept)
    return sum + residual * residual
  }, 0)
  const ssTot = points.reduce((sum, point) => {
    return sum + (point.y - meanY) ** 2
  }, 0)

  return {
    slope,
    intercept,
    rSquared: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
  }
}

function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  return value.toPrecision(digits)
}

function niceStep(rawStep) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1
  }

  const power = Math.floor(Math.log10(rawStep))
  const scale = 10 ** power
  const fraction = rawStep / scale
  const candidates = [1, 2, 2.5, 5, 10]
  const chosen = candidates.find((candidate) => fraction <= candidate) ?? 10

  return chosen * scale
}

function decimalPlaces(step) {
  for (let places = 0; places <= 8; places += 1) {
    const scaled = step * 10 ** places
    if (Math.abs(Math.round(scaled) - scaled) < 1e-9) {
      return places
    }
  }
  return 8
}

function formatTick(value, step) {
  const magnitude = Math.abs(value)
  if (magnitude >= 1e5 || (magnitude > 0 && magnitude <= 1e-6)) {
    return value.toExponential(3)
  }

  const places = decimalPlaces(step)
  return value
    .toFixed(places)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1')
}

function buildNiceTicks(minValue, maxValue, targetTicks = 6) {
  const safeMax =
    maxValue > minValue
      ? maxValue
      : minValue + Math.max(Math.abs(minValue), Math.abs(maxValue), 1) * 1e-6
  const rawStep = (safeMax - minValue) / Math.max(targetTicks, 1)
  const step = niceStep(rawStep)
  const count = Math.ceil((safeMax - minValue) / step)
  const ticks = Array.from({ length: count + 1 }, (_, index) => {
    const value = minValue + index * step
    return Math.abs(value) < 1e-12 ? 0 : value
  })

  return {
    step,
    ticks,
    max: minValue + count * step,
  }
}

function resizeTrials(trials, targetLength) {
  return Array.from({ length: targetLength }, (_, index) => trials[index] ?? '')
}

function sanitizeFileName(value) {
  const trimmed = value.trim()

  if (!trimmed) {
    return '12xgraph-chart'
  }

  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}


function App() {
  const [experimentTitle, setExperimentTitle] = useState('Experiment Title')
  const [independentName, setIndependentName] = useState('Independent Variable')
  const [dependentName, setDependentName] = useState('Dependent Variable')
  const [independentUncertainty, setIndependentUncertainty] = useState('0.1')
  const [dependentUncertainty, setDependentUncertainty] = useState('0.1')
  const [xAxisMinimum, setXAxisMinimum] = useState('0')
  const [yAxisMinimum, setYAxisMinimum] = useState('0')
  const [equationHorizontal, setEquationHorizontal] = useState('center')
  const [equationVertical, setEquationVertical] = useState('top')
  const [trialCount, setTrialCount] = useState(INITIAL_TRIALS)
  const [rows, setRows] = useState([
    { independent: '1', trials: ['2.1', '2.0'] },
    { independent: '2', trials: ['4.1', '3.9'] },
    { independent: '3', trials: ['6.1', '5.8'] },
  ])
  const svgRef = useRef(null)

  const processed = useMemo(() => {
    const xInstrumental = parseNumber(independentUncertainty) ?? 0
    const yInstrumental = parseNumber(dependentUncertainty) ?? 0

    const points = rows
      .map((row, rowIndex) => {
        const x = parseNumber(row.independent)
        const trialValues = row.trials
          .map((trial) => parseNumber(trial))
          .filter((value) => value !== null)

        if (x === null || trialValues.length === 0) {
          return null
        }

        const meanY =
          trialValues.reduce((sum, value) => sum + value, 0) / trialValues.length
        const stdev = sampleStandardDeviation(trialValues)

        return {
          id: rowIndex,
          x,
          y: meanY,
          xError: Math.max(0, xInstrumental),
          yError: Math.max(yInstrumental, stdev),
        }
      })
      .filter((point) => point !== null)

    const fit = linearRegression(points)

    return {
      points,
      fit,
    }
  }, [rows, independentUncertainty, dependentUncertainty])

  const chart = useMemo(() => {
    const { points } = processed
    if (points.length === 0) {
      return null
    }

    const width = 920
    const height = 600
    const margin = { top: 72, right: 64, bottom: 88, left: 96 }

    const dataXMax = Math.max(...points.map((point) => point.x))
    const dataYMax = Math.max(...points.map((point) => point.y))

    const requestedXMin = parseNumber(xAxisMinimum) ?? 0
    const requestedYMin = parseNumber(yAxisMinimum) ?? 0

    const xMin = requestedXMin
    const yMin = requestedYMin

    const upperXBound =
      dataXMax > xMin
        ? dataXMax
        : xMin + Math.max(Math.abs(xMin), Math.abs(dataXMax), 1) * 1e-7
    const upperYBound =
      dataYMax > yMin
        ? dataYMax
        : yMin + Math.max(Math.abs(yMin), Math.abs(dataYMax), 1) * 1e-7
    const xRange = upperXBound - xMin
    const yRange = upperYBound - yMin

    const xTickInfo = buildNiceTicks(xMin, upperXBound + xRange * 0.1)
    const yTickInfo = buildNiceTicks(yMin, upperYBound + yRange * 0.1)

    const xMax = xTickInfo.max
    const yMax = yTickInfo.max

    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom

    const xToPx = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * plotWidth
    const yToPx = (y) => margin.top + ((yMax - y) / (yMax - yMin)) * plotHeight

    const xTicks = xTickInfo.ticks
    const yTicks = yTickInfo.ticks

    return {
      width,
      height,
      margin,
      xToPx,
      yToPx,
      xTicks,
      yTicks,
      xTickStep: xTickInfo.step,
      yTickStep: yTickInfo.step,
      xMin,
      xMax,
      yMin,
      yMax,
    }
  }, [processed, xAxisMinimum, yAxisMinimum])

  const equationText = useMemo(() => {
    if (!processed.fit) {
      return 'Need at least two valid data points for a best-fit line.'
    }

    const { slope, intercept } = processed.fit
    const slopeText = formatNumber(slope)
    const interceptSign = intercept >= 0 ? '+' : '-'
    const interceptText = formatNumber(Math.abs(intercept))

    return `y = ${slopeText}x ${interceptSign} ${interceptText}`
  }, [processed.fit])

  const equationPlacement = useMemo(() => {
    const xOptions = {
      left: { x: 16, anchor: 'start' },
      center: { x: 50, anchor: 'middle' },
      right: { x: 84, anchor: 'end' },
    }

    const yOptions = {
      top: 18,
      middle: 50,
      bottom: 82,
    }

    return {
      ...xOptions[equationHorizontal],
      y: yOptions[equationVertical],
    }
  }, [equationHorizontal, equationVertical])

  const downloadChartAsPng = async () => {
    if (!chart || !svgRef.current) {
      return
    }

    const svgNode = svgRef.current
    const clonedSvg = svgNode.cloneNode(true)
    clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    clonedSvg.setAttribute('width', String(chart.width))
    clonedSvg.setAttribute('height', String(chart.height))

    const exportBackground = clonedSvg.querySelector('rect[fill="url(#plotFill)"]')
    if (exportBackground) {
      exportBackground.setAttribute('fill', '#ffffff')
    }


    const exportStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    exportStyle.textContent = `


      text {
        font-family: sans-serif;
      }

      .plot-title,
      .axis-label {
        font-family: sans-serif;
      }

      .grid-line {
        stroke: #dbcdb4;
        stroke-width: 1;
        stroke-opacity: 0.55;
      }

      .axis-line {
        stroke: #3f3728;
        stroke-width: 1.6;
      }

      .fit-line {
        stroke: #d04d16;
        stroke-width: 2.8;
        stroke-dasharray: 10 6;
      }

      .error-bar {
        stroke: #1c3029;
        stroke-width: 1.5;
      }

      .point {
        fill: #f08f27;
        stroke: #743d00;
        stroke-width: 1.2;
      }

      .plot-title {
        fill: #231e15;
        font-size: 1.2rem;
        font-weight: 700;
      }

      .tick-text {
        fill: #4b4235;
        font-size: 0.78rem;
        font-family: 'SFMono-Regular', Menlo, monospace;
      }

      .axis-label {
        fill: #312a20;
        font-size: 0.92rem;
        font-weight: 700;
      }

      .equation {
        fill: #453825;
        font-size: 0.8rem;
        font-family: 'SFMono-Regular', Menlo, monospace;
      }
    `
    clonedSvg.insertBefore(exportStyle, clonedSvg.firstChild)

    const svgData = new XMLSerializer().serializeToString(clonedSvg)
    const svgBlob = new Blob([svgData], {
      type: 'image/svg+xml;charset=utf-8',
    })
    const svgUrl = URL.createObjectURL(svgBlob)

    try {
      const image = new Image()
      image.crossOrigin = 'anonymous'

      await new Promise((resolve, reject) => {
        image.onload = resolve
        image.onerror = reject
        image.src = svgUrl
      })

      const scale = Math.max(window.devicePixelRatio || 1, 2)
      const canvas = document.createElement('canvas')
      canvas.width = chart.width * scale
      canvas.height = chart.height * scale

      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Unable to create canvas context')
      }

      context.scale(scale, scale)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, chart.width, chart.height)
      context.drawImage(image, 0, 0, chart.width, chart.height)

      const pngBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('PNG export failed'))
          }
        }, 'image/png')
      })

      const downloadUrl = URL.createObjectURL(pngBlob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `${sanitizeFileName(experimentTitle)}.png`
      link.click()
      URL.revokeObjectURL(downloadUrl)
    } finally {
      URL.revokeObjectURL(svgUrl)
    }
  }

  const updateIndependent = (rowIndex, value) => {
    setRows((currentRows) =>
      currentRows.map((row, index) => {
        if (index !== rowIndex) {
          return row
        }
        return { ...row, independent: value }
      }),
    )
  }

  const updateTrial = (rowIndex, trialIndex, value) => {
    setRows((currentRows) =>
      currentRows.map((row, index) => {
        if (index !== rowIndex) {
          return row
        }

        const nextTrials = [...row.trials]
        while (nextTrials.length < trialCount) {
          nextTrials.push('')
        }
        nextTrials[trialIndex] = value

        return {
          ...row,
          trials: nextTrials,
        }
      }),
    )
  }

  const addRow = () => {
    setRows((currentRows) => [...currentRows, emptyRow(trialCount)])
  }

  const removeRow = (rowIndex) => {
    setRows((currentRows) => {
      if (currentRows.length <= 1) {
        return currentRows
      }
      return currentRows.filter((_, index) => index !== rowIndex)
    })
  }

  const addTrialColumn = () => {
    const nextTrialCount = trialCount + 1
    setTrialCount(nextTrialCount)
    setRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        trials: resizeTrials(row.trials, nextTrialCount),
      })),
    )
  }

  const removeTrialColumn = () => {
    if (trialCount <= 1) {
      return
    }

    const nextTrialCount = trialCount - 1
    setTrialCount(nextTrialCount)
    setRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        trials: resizeTrials(row.trials, nextTrialCount),
      })),
    )
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">PHYS 12X Lab Graph Generator</p>
        <h1>12xGraph</h1>
        <p className="hero-copy">
          Enter your experimental data, uncertainties, and trial measurements to
          generate a scatter plot with propagated error bars and a best-fit line.
        </p>
        <br></br>
        <a href="https://faletto.github.io"><button>Made by  <i class="fa-brands fa-github" /> /faletto</button></a>
      </header>

      <section className="panel inputs-panel" aria-label="Experiment inputs">
        <h2>Experiment Setup</h2>
        <div className="field-grid">
          <label>
            Experiment Title
            <input
              value={experimentTitle}
              onChange={(event) => setExperimentTitle(event.target.value)}
              placeholder="e.g. Pendulum Period vs Length"
            />
          </label>
          <label>
            Independent Variable Name
            <input
              value={independentName}
              onChange={(event) => setIndependentName(event.target.value)}
              placeholder="e.g. Length (m)"
            />
          </label>
          <label>
            Independent Instrumental Uncertainty
            <input
              value={independentUncertainty}
              onChange={(event) => setIndependentUncertainty(event.target.value)}
              placeholder="e.g. 0.01"
            />
          </label>
          <label>
            Dependent Variable Name
            <input
              value={dependentName}
              onChange={(event) => setDependentName(event.target.value)}
              placeholder="e.g. Period (s)"
            />
          </label>
          <label>
            Dependent Instrumental Uncertainty
            <input
              value={dependentUncertainty}
              onChange={(event) => setDependentUncertainty(event.target.value)}
              placeholder="e.g. 0.05"
            />
          </label>
          <label>
            Minimum X-Axis Value
            <input
              value={xAxisMinimum}
              onChange={(event) => setXAxisMinimum(event.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            Minimum Y-Axis Value
            <input
              value={yAxisMinimum}
              onChange={(event) => setYAxisMinimum(event.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            Equation Horizontal Position
            <select
              value={equationHorizontal}
              onChange={(event) => setEquationHorizontal(event.target.value)}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label>
            Equation Vertical Position
            <select
              value={equationVertical}
              onChange={(event) => setEquationVertical(event.target.value)}
            >
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel" aria-label="Data entry table">
        <div className="section-head">
          <h2>Data Table</h2>
          <div className="button-row">
            <button type="button" onClick={addTrialColumn}>
              Add Trial Column
            </button>
            <button type="button" onClick={removeTrialColumn}>
              Remove Trial Column
            </button>
            <button type="button" onClick={addRow}>
              Add Data Row
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{independentName || 'Independent Variable'}</th>
                {Array.from({ length: trialCount }, (_, index) => (
                  <th key={index}>{dependentName || 'Dependent'} Trial {index + 1}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td>
                    <input
                      value={row.independent}
                      onChange={(event) =>
                        updateIndependent(rowIndex, event.target.value)
                      }
                      placeholder="x"
                    />
                  </td>
                  {Array.from({ length: trialCount }, (_, trialIndex) => (
                    <td key={trialIndex}>
                      <input
                        value={row.trials[trialIndex] ?? ''}
                        onChange={(event) =>
                          updateTrial(rowIndex, trialIndex, event.target.value)
                        }
                        placeholder="y"
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => removeRow(rowIndex)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" aria-label="Scatter plot output">
        <div className="section-head">
          <h2>Graph Output</h2>
          <div className="button-row graph-actions">
            <p>
              Valid points: <strong>{processed.points.length}</strong>
            </p>
            <button type="button" onClick={downloadChartAsPng} disabled={!chart}>
              <i class="fa-solid fa-download" /> Download PNG
            </button>
          </div>
        </div>

        {chart ? (
          <div className="chart-frame">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label="Scatter plot with error bars and best-fit line"
            >
              <rect
                data-plot-background="true"
                x={chart.margin.left}
                y={chart.margin.top}
                width={chart.width - chart.margin.left - chart.margin.right}
                height={chart.height - chart.margin.top - chart.margin.bottom}
                rx="14"
                fill="#ffffff"
              />

              <text x={chart.width / 2} y="38" textAnchor="middle" className="plot-title">
                {experimentTitle || 'Experiment'}
              </text>

              {chart.xTicks.map((tick, index) => {
                const x = chart.xToPx(tick)
                return (
                  <g key={`x-${index}`}>
                    <line
                      x1={x}
                      y1={chart.margin.top}
                      x2={x}
                      y2={chart.height - chart.margin.bottom}
                      className="grid-line"
                    />
                    <line
                      x1={x}
                      y1={chart.height - chart.margin.bottom}
                      x2={x}
                      y2={chart.height - chart.margin.bottom + 8}
                      className="axis-line"
                    />
                    <text
                      x={x}
                      y={chart.height - chart.margin.bottom + 24}
                      textAnchor="middle"
                      className="tick-text"
                    >
                      {formatTick(tick, chart.xTickStep)}
                    </text>
                  </g>
                )
              })}

              {chart.yTicks.map((tick, index) => {
                const y = chart.yToPx(tick)
                return (
                  <g key={`y-${index}`}>
                    <line
                      x1={chart.margin.left}
                      y1={y}
                      x2={chart.width - chart.margin.right}
                      y2={y}
                      className="grid-line"
                    />
                    <line
                      x1={chart.margin.left - 8}
                      y1={y}
                      x2={chart.margin.left}
                      y2={y}
                      className="axis-line"
                    />
                    <text
                      x={chart.margin.left - 14}
                      y={y + 4}
                      textAnchor="end"
                      className="tick-text"
                    >
                      {formatTick(tick, chart.yTickStep)}
                    </text>
                  </g>
                )
              })}

              <line
                x1={chart.margin.left}
                y1={chart.height - chart.margin.bottom}
                x2={chart.width - chart.margin.right}
                y2={chart.height - chart.margin.bottom}
                className="axis-line"
              />
              <line
                x1={chart.margin.left}
                y1={chart.margin.top}
                x2={chart.margin.left}
                y2={chart.height - chart.margin.bottom}
                className="axis-line"
              />

              {processed.fit ? (
                <line
                  x1={chart.xToPx(chart.xMin)}
                  y1={chart.yToPx(
                    processed.fit.slope * chart.xMin + processed.fit.intercept,
                  )}
                  x2={chart.xToPx(chart.xMax)}
                  y2={chart.yToPx(
                    processed.fit.slope * chart.xMax + processed.fit.intercept,
                  )}
                  className="fit-line"
                />
              ) : null}

              {processed.points.map((point) => {
                const px = chart.xToPx(point.x)
                const py = chart.yToPx(point.y)
                const xMin = chart.xToPx(point.x - point.xError)
                const xMax = chart.xToPx(point.x + point.xError)
                const yMin = chart.yToPx(point.y - point.yError)
                const yMax = chart.yToPx(point.y + point.yError)

                return (
                  <g key={point.id}>
                    <line x1={xMin} y1={py} x2={xMax} y2={py} className="error-bar" />
                    <line x1={xMin} y1={py - 5} x2={xMin} y2={py + 5} className="error-bar" />
                    <line x1={xMax} y1={py - 5} x2={xMax} y2={py + 5} className="error-bar" />

                    <line x1={px} y1={yMin} x2={px} y2={yMax} className="error-bar" />
                    <line x1={px - 5} y1={yMin} x2={px + 5} y2={yMin} className="error-bar" />
                    <line x1={px - 5} y1={yMax} x2={px + 5} y2={yMax} className="error-bar" />

                    <circle cx={px} cy={py} r="5" className="point" />
                  </g>
                )
              })}

              <g
                transform={`translate(${chart.margin.left + ((chart.width - chart.margin.left - chart.margin.right) * equationPlacement.x) / 100} ${chart.margin.top + ((chart.height - chart.margin.top - chart.margin.bottom) * equationPlacement.y) / 100})`}
              >
                <text
                  textAnchor={equationPlacement.anchor}
                  className="equation"
                >
                  {equationText}
                </text>
                <text
                  y="22"
                  textAnchor={equationPlacement.anchor}
                  className="equation"
                >
                  R
                  <tspan dy="-5" fontSize="11">
                    2
                  </tspan>
                  <tspan dy="5"> = {formatNumber(processed.fit?.rSquared ?? Number.NaN)}</tspan>
                </text>
              </g>

              <text
                x={(chart.width + chart.margin.left - chart.margin.right) / 2}
                y={chart.height - 20}
                textAnchor="middle"
                className="axis-label"
              >
                {independentName || 'Independent Variable'}
              </text>
              <text
                transform={`translate(24 ${(chart.height + chart.margin.top - chart.margin.bottom) / 2}) rotate(-90)`}
                textAnchor="middle"
                className="axis-label"
              >
                {dependentName || 'Dependent Variable'}
              </text>
            </svg>
          </div>
        ) : (
          <p className="empty-state">
            Enter numeric values in the table to generate the graph.
          </p>
        )}
      </section>
    </main>
  )
}

export default App
