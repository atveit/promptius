import React, { useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

const PromptEvaluationGrid = () => {
  const [variables, setVariables] = useState([
    { var1: "yoda jumped high", vartwo: "but had to fly", varthreeee: "before vader" },
    { var1: "yoda2 jumped high", vartwo: "but had to fly", varthreeee: "before vader" },
    { var1: "yoda3 jumped high", vartwo: "but had to fly", varthreeee: "before vader" },
  ]);
  const [prompts, setPrompts] = useState([
    { prompt: "Translate to italian", comment: "the prompt" },
    { prompt: "Translate to swedish", comment: "another prompt" },
  ]);

  const [results, setResults] = useState({});

  const [userFeedback, setUserFeedback] = useState({});
  const [debugInfo, setDebugInfo] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [processedCells, setProcessedCells] = useState({});
  const [modalContent, setModalContent] = useState(null);
  const [focusedCell, setFocusedCell] = useState({ rowIndex: 0, promptIndex: 0 });
  const [evaluators, setEvaluators] = useState([]); // State for evaluator prompts

  const parseTSV = useCallback((text) => {
    const rows = text.trim().split('\n');
    const headers = rows[0].split('\t');
    return rows.slice(1).map(row => {
      const values = row.split('\t');
      return headers.reduce((obj, header, index) => {
        obj[header] = values[index];
        return obj;
      }, {});
    });
  }, []);

const JsonRenderer = ({ data, level = 0 }) => {
  const indent = '  '.repeat(level);

  if (typeof data !== 'object' || data === null) {
    return <span style={{ color: typeof data === 'string' ? '#8bc34a' : '#03a9f4' }}>{JSON.stringify(data)}</span>;
  }

  const isArray = Array.isArray(data);
  const brackets = isArray ? '[]' : '{}';
  const items = Object.entries(data);

  return (
    <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      {brackets[0]}
      {items.map(([key, value], index) => (
        <div key={key} style={{ marginLeft: '20px' }}>
          {!isArray && <span style={{ color: '#ff9800' }}>{JSON.stringify(key)}: </span>}
          <JsonRenderer data={value} level={level + 1} />
          {index < items.length - 1 && ','}
        </div>
      ))}
      {indent}{brackets[1]}
    </div>
  );
};

  const handleFileUpload = useCallback((event, type) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        const parsed = parseTSV(content);
        if (type === 'variables') {
          setVariables(parsed);
        } else if (type === 'prompts') {
          setPrompts(parsed);
        }
      };
      reader.readAsText(file);
    }
  }, [parseTSV]);

 const handleEvaluatorFileUpload = useCallback((event) => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const parsed = parseTSV(content);
      setEvaluators(parsed);
      console.log('Loaded evaluators:', parsed);
    };
    reader.readAsText(file);
  }
}, [parseTSV]);

const executePrompts = useCallback(async () => {
  const newResults = { ...results };
  const newDebugInfo = { ...debugInfo };
  const newProcessedCells = { ...processedCells };

  for (let rowIndex = 0; rowIndex < variables.length; rowIndex++) {
    newResults[rowIndex] = newResults[rowIndex] || {};
    for (let promptIndex = 0; promptIndex < prompts.length; promptIndex++) {
      setActiveCell({ rowIndex, promptIndex });
      const prompt = prompts[promptIndex];
      const promptText = prompt.prompt.replace(/{{(\w+)}}/g, (_, key) => variables[rowIndex][key] || '');
      try {
        const response = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer no-key'
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: promptText }]
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const output = data.choices[0].message.content;

        newResults[rowIndex][promptIndex] = { output, evaluations: [] };
        newDebugInfo[`${rowIndex}-${promptIndex}`] = "Success";

        // Execute evaluators for this prompt
        const evaluations = await executeEvaluatorsForPrompt(output, variables[rowIndex]);
        newResults[rowIndex][promptIndex].evaluations = evaluations;

      } catch (error) {
        console.error('Error executing prompt:', error);
        newResults[rowIndex][promptIndex] = { output: 'Error executing prompt', evaluations: [] };
        newDebugInfo[`${rowIndex}-${promptIndex}`] = `Error: ${error.message}`;
      }
      newProcessedCells[`${rowIndex}-${promptIndex}`] = true;
      
      // Update state after each cell is processed
      setResults({ ...newResults });
      setDebugInfo({ ...newDebugInfo });
      setProcessedCells({ ...newProcessedCells });
    }
  }
  setActiveCell(null);
}, [variables, prompts, results, debugInfo, processedCells]);


const executeEvaluators = useCallback(async () => {
  const newResults = { ...results };
  for (let rowIndex = 0; rowIndex < variables.length; rowIndex++) {
    for (let promptIndex = 0; promptIndex < prompts.length; promptIndex++) {
      const cellContent = newResults[rowIndex][promptIndex];
      if (cellContent) {
        const evaluations = [];
        for (let evaluatorIndex = 0; evaluatorIndex < evaluators.length; evaluatorIndex++) {
          const evaluator = evaluators[evaluatorIndex];
          const evaluatorPrompt = evaluator.prompt
            .replace(/{{PROMPTRESULT}}/g, cellContent.output)
            .replace(/{{(\w+)}}/g, (_, key) => variables[rowIndex][key] || '');

          try {
            const response = await fetch('/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer no-key'
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: evaluatorPrompt }]
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            let output = data.choices[0].message.content;
            
            // Remove any markdown formatting or triple quotes
            output = output.replace(/```json\s?|\s?```/g, '').trim();
            
            // Parse the cleaned JSON response
            const parsedOutput = JSON.parse(output);
            evaluations.push(parsedOutput);

          } catch (error) {
            console.error('Error executing evaluator prompt:', error);
            evaluations.push({
              Evalname: evaluator.evalname,
              score: null,
              why: `Error executing evaluator prompt: ${error.message}`
            });
          }
        }
        newResults[rowIndex][promptIndex].evaluations = evaluations;
      }
    }
  }
  setResults({ ...newResults });
}, [evaluators, variables, results, prompts.length]);



const executeEvaluatorsForPrompt = async (promptResult, rowVariables) => {
  const evaluations = [];
  for (let evaluatorIndex = 0; evaluatorIndex < evaluators.length; evaluatorIndex++) {
    const evaluator = evaluators[evaluatorIndex];
    const evaluatorPrompt = evaluator.prompt
      .replace(/{{PROMPTRESULT}}/g, promptResult)
      .replace(/{{(\w+)}}/g, (_, key) => rowVariables[key] || '');

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer no-key'
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: evaluatorPrompt }]
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      let output = data.choices[0].message.content;
      
      // Remove any markdown formatting or triple quotes
      output = output.replace(/```json\s?|\s?```/g, '').trim();
      
      // Parse the cleaned JSON response
      const parsedOutput = JSON.parse(output);
      evaluations.push(parsedOutput);

    } catch (error) {
      console.error('Error executing evaluator prompt:', error);
      evaluations.push({
        Evalname: evaluator.evalname,
        score: null,
        why: `Error executing evaluator prompt: ${error.message}`
      });
    }
  }
  return evaluations;
};


  const handleVote = useCallback((rowIndex, promptIndex, vote) => {
    setUserFeedback(prev => {
      const currentVote = prev[`${rowIndex}-${promptIndex}`]?.vote;
      let newVote;
      if (currentVote === vote) {
        newVote = undefined;
      } else {
        newVote = vote;
      }
      return {
        ...prev,
        [`${rowIndex}-${promptIndex}`]: { ...prev[`${rowIndex}-${promptIndex}`], vote: newVote }
      };
    });
  }, []);

  const handleComment = useCallback((rowIndex, promptIndex) => {
    const comment = prompt("Enter your comment:");
    if (comment) {
      setUserFeedback(prev => ({
        ...prev,
        [`${rowIndex}-${promptIndex}`]: { ...prev[`${rowIndex}-${promptIndex}`], comment }
      }));
    }
  }, []);

  const saveResults = useCallback(() => {
    const resultsToSave = {
      variables,
      prompts,
      results,
      userFeedback,
      evaluators // Include evaluators in saved data
    };
    const blob = new Blob([JSON.stringify(resultsToSave, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompt_evaluation_results.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [variables, prompts, results, userFeedback, evaluators]);

  const cellStyle = {
    border: '1px solid #ddd',
    padding: '10px',
    fontSize: '14px',
    maxHeight: '100px',
    overflow: 'auto',
    cursor: 'pointer',
  };

  const headerCellStyle = {
    ...cellStyle,
    backgroundColor: '#f2f2f2',
    fontWeight: 'bold',
    cursor: 'default',
  };

  const dataHeaderCellStyle = {
    ...cellStyle,
    backgroundColor: '#e3f2fd', // Light blue color for data headers
    fontWeight: 'bold',
    cursor: 'pointer', // Make headers clickable
  };

  const buttonStyle = {
    backgroundColor: '#4CAF50',
    color: 'white',
    padding: '10px 20px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    marginRight: '10px',
    marginBottom: '10px',
  };

  const evaluatorButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#008080' // Teal for evaluator actions
  };

  const saveButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#FF5733', // Bright Red color to indicate importance
    display: 'flex', // Aligns text and icon
    alignItems: 'center',
    justifyContent: 'center',
  };

  const getCellStyle = (rowIndex, promptIndex) => {
    const isActive = activeCell && activeCell.rowIndex === rowIndex && activeCell.promptIndex === promptIndex;
    const isFocused = focusedCell.rowIndex === rowIndex && focusedCell.promptIndex === promptIndex;
    const isProcessed = processedCells[`${rowIndex}-${promptIndex}`];

    return {
      ...cellStyle,
      backgroundColor: isFocused ? '#b3e5fc' : isActive ? '#fff9c4' : isProcessed ? '#e8f5e9' : 'white',
      position: 'relative',
      outline: isFocused ? '2px solid #03a9f4' : 'none',
    };
  };

  const ActiveCellIndicator = () => (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: '100%',
        height: '4px',
        backgroundColor: '#4CAF50',
        animation: 'progressAnimation 2s infinite',
      }}
    />
  );

const Modal = ({ content, onClose }) => (
  <div style={{
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  }}>
    <div style={{
      backgroundColor: 'white',
      padding: '20px',
      borderRadius: '5px',
      maxWidth: '80%',
      maxHeight: '80%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '10px',
      }}>
        <h2 style={{ margin: 0 }}>Cell Content</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <div style={{
        overflowY: 'auto',
        overflowX: 'auto',
        flexGrow: 1,
      }}>
        {typeof content === 'object' ? (
          <JsonRenderer data={content} />
        ) : (
          <ReactMarkdown>{content}</ReactMarkdown>
        )}
      </div>
    </div>
  </div>
); 

const handleCellClick = useCallback((rowIndex, promptIndex, cellType) => {
  let content;
  if (cellType === 'variable') {
    content = variables[rowIndex][Object.keys(variables[rowIndex])[promptIndex]];
  } else if (cellType === 'evaluation') {
    content = results[rowIndex]?.[promptIndex]?.evaluations || [];
  } else {
    const cellContent = results[rowIndex]?.[promptIndex] || {};
    content = `
**Output:**  
${cellContent.output || 'No result yet'}

**Debug Info:**  
${debugInfo[`${rowIndex}-${promptIndex}`] || 'No debug info available'}

**User Feedback:**  
- 👍: ${userFeedback[`${rowIndex}-${promptIndex}`]?.vote === 'up' ? 'Yes' : 'No'}
- 👎: ${userFeedback[`${rowIndex}-${promptIndex}`]?.vote === 'down' ? 'Yes' : 'No'}
- 💬: ${userFeedback[`${rowIndex}-${promptIndex}`]?.comment || 'No comment'}

**Evaluations:**  
${cellContent.evaluations?.map(evaluation => `${evaluation.Evalname}: ${evaluation.score}`).join('\n') || 'No evaluations'}
    `;
  }
  setModalContent(content);
}, [variables, results, debugInfo, userFeedback]);




    
  const handleHeaderClick = (index) => {
    const headerContent = `
**Prompt:**  
${prompts[index].prompt}

**Comment:**  
${prompts[index].comment || 'No comment'}
    `;
    setModalContent(headerContent);
  };

  const handleKeyDown = useCallback((e) => {
    if (!focusedCell) return;

    const { rowIndex, promptIndex } = focusedCell;
    let newRowIndex = rowIndex;
    let newPromptIndex = promptIndex;

    switch (e.key) {
      case 'ArrowUp':
        newRowIndex = Math.max(rowIndex - 1, 0);
        break;
      case 'ArrowDown':
        newRowIndex = Math.min(rowIndex + 1, variables.length - 1);
        break;
      case 'ArrowLeft':
        newPromptIndex = Math.max(promptIndex - 1, 0);
        break;
      case 'ArrowRight':
        newPromptIndex = Math.min(promptIndex + 1, prompts.length - 1);
        break;
      case 'Enter':
        handleCellClick(rowIndex, promptIndex, 'result');
        break;
      case 'u':
        handleVote(rowIndex, promptIndex, 'up');
        break;
      case 'd':
        handleVote(rowIndex, promptIndex, 'down');
        break;
      case 'c':
        handleComment(rowIndex, promptIndex);
        break;
      case 'x':
        if (modalContent) {
          setModalContent(null);
        }
        break;
      default:
        return;
    }

    if (newRowIndex !== rowIndex || newPromptIndex !== promptIndex) {
      setFocusedCell({ rowIndex: newRowIndex, promptIndex: newPromptIndex });
    }
  }, [focusedCell, variables.length, prompts.length, handleVote, handleComment, modalContent, handleCellClick]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px' }}>
      <style>
        {`
          @keyframes progressAnimation {
            0% { width: 0%; }
            50% { width: 100%; }
            100% { width: 0%; }
          }
        `}
      </style>
      <h1 style={{ textAlign: 'center' }}>Promptius</h1>

      <div style={{ marginBottom: '20px' }}>
        <input type="file" accept=".tsv" onChange={(e) => handleFileUpload(e, 'variables')} style={{ display: 'none' }} id="variablesUpload" />
        <label htmlFor="variablesUpload" style={buttonStyle}>Load Variables</label>

        <input type="file" accept=".tsv" onChange={(e) => handleFileUpload(e, 'prompts')} style={{ display: 'none' }} id="promptsUpload" />
        <label htmlFor="promptsUpload" style={buttonStyle}>Load Prompts</label>

        <input type="file" accept=".tsv" onChange={handleEvaluatorFileUpload} style={{ display: 'none' }} id="evaluatorsUpload" />
        <label htmlFor="evaluatorsUpload" style={evaluatorButtonStyle}>Load Evaluators</label>

        <button onClick={executePrompts} style={buttonStyle}>Execute Prompts</button>
        <button onClick={executeEvaluators} style={evaluatorButtonStyle}>Execute Evaluators</button>

        <button onClick={saveResults} style={saveButtonStyle}>💾 Save Results</button>
      </div>

<table style={{ borderCollapse: 'collapse', width: '100%' }}>
  <thead>
    <tr>
      <th colSpan={Object.keys(variables[0] || {}).length} style={headerCellStyle}>Variables</th>
      {prompts.map((_, index) => (
        <React.Fragment key={index}>
          <th style={headerCellStyle}>Prompt {index + 1}</th>
          <th style={headerCellStyle}>Eval {index + 1}</th>
        </React.Fragment>
      ))}
    </tr>
    <tr>
      {Object.keys(variables[0] || {}).map((key, index) => (
        <th key={index} style={dataHeaderCellStyle} onClick={() => handleHeaderClick(index)}>
          {key}
        </th>
      ))}
      {prompts.map((prompt, index) => (
        <React.Fragment key={index}>
          <th style={dataHeaderCellStyle} onClick={() => handleHeaderClick(index)}>
            {prompt.prompt}
            <br />
            {prompt.comment && <small>{prompt.comment}</small>}
          </th>
          <th style={dataHeaderCellStyle}>Evaluations</th>
        </React.Fragment>
      ))}
    </tr>
  </thead>
  <tbody>
    {variables.map((variable, rowIndex) => (
      <tr key={rowIndex}>
        {Object.values(variable).map((value, cellIndex) => (
          <td
            key={cellIndex}
            style={cellStyle}
            onClick={() => handleCellClick(rowIndex, cellIndex, 'variable')}
          >
            {value}
          </td>
        ))}
{prompts.map((_, promptIndex) => (
  <React.Fragment key={promptIndex}>
    <td
      style={getCellStyle(rowIndex, promptIndex)}
      onClick={() => handleCellClick(rowIndex, promptIndex, 'result')}
    >
      {results[rowIndex]?.[promptIndex] ? (
        <div>
          <div style={{ maxHeight: '80px', overflow: 'auto' }}>{results[rowIndex][promptIndex].output}</div>
          <div style={{ marginTop: '10px' }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleVote(rowIndex, promptIndex, 'up'); }}
              style={{
                marginRight: '5px',
                backgroundColor: userFeedback[`${rowIndex}-${promptIndex}`]?.vote === 'up' ? '#4CAF50' : 'initial'  // Green for selected
              }}
            >
              ✅
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleVote(rowIndex, promptIndex, 'down'); }}
              style={{
                marginRight: '5px',
                backgroundColor: userFeedback[`${rowIndex}-${promptIndex}`]?.vote === 'down' ? '#f44336' : 'initial'  // Red for selected
              }}
            >
              ❌
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleComment(rowIndex, promptIndex); }}>💬</button>
          </div>
          {userFeedback[`${rowIndex}-${promptIndex}`]?.comment && (
            <div>Comment: {userFeedback[`${rowIndex}-${promptIndex}`].comment}</div>
          )}
        </div>
      ) : 'No result yet'}
      {activeCell && activeCell.rowIndex === rowIndex && activeCell.promptIndex === promptIndex && <ActiveCellIndicator />}
    </td>
    <td
      style={{
        ...cellStyle,
        cursor: 'pointer',
        maxWidth: '300px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
      onClick={() => handleCellClick(rowIndex, promptIndex, 'evaluation')}
    >
      {results[rowIndex]?.[promptIndex]?.evaluations ? (
        <div>
          {results[rowIndex][promptIndex].evaluations.map((evaluation, index) => (
            <div key={index}>
              {evaluation.Evalname}: {evaluation.score}
            </div>
          ))}
        </div>
      ) : 'No evaluations'}
    </td>
  </React.Fragment>
))}

      </tr>
    ))}
  </tbody>
</table>


     

      
      {modalContent && <Modal content={modalContent} onClose={() => setModalContent(null)} />}
    </div>
  );
};

export default PromptEvaluationGrid;

