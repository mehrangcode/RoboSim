import { initCodeAnalysis } from '@robosim/code-analysis';
import { nodeCodeAnalysisWasm } from '@robosim/code-analysis/node';

// Loading a project runs the code-aware safety rules, which need the tree-sitter parser.
await initCodeAnalysis(nodeCodeAnalysisWasm());
