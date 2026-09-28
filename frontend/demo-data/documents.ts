import type { Document } from "@integrity/shared";
const template =
  "Discuss how shared green spaces influence urban communities. Use examples to support your argument.";
const common =
  "Community gardens create shared spaces where residents exchange knowledge and build lasting relationships. Access to green space can strengthen neighborhood connections through repeated informal encounters.";
const water =
  "Collecting rainwater in shared containers reduces the demand for treated water. A rotating schedule gives each household a practical role in maintaining the garden.";
export const demoDocuments: Document[] = [
  {
    id: "SUB-001",
    title: "The social roots of urban gardens",
    author: "Maya Ellis",
    kind: "submission",
    text:
      template +
      "\n\n" +
      common +
      "\n\n" +
      water +
      "\n\nA garden is more than a collection of plants. In my fictional neighborhood example, the weekly planting sessions gave residents a reason to meet and plan together.",
  },
  {
    id: "SUB-002",
    title: "Green spaces, stronger communities",
    author: "Noah Bennett",
    kind: "submission",
    text:
      template +
      "\n\n" +
      common +
      "\n\nShared rainwater containers reduce demand for treated water. Giving households a rotating schedule provides a practical role in garden maintenance.\n\nThe most useful community projects combine ecological benefits with opportunities for conversation.",
  },
  {
    id: "SUB-003",
    title: "Participation beyond the garden gate",
    author: "Avery Chen",
    kind: "submission",
    text:
      template +
      "\n\nNeighborhood gardens offer common spaces where people share knowledge and develop lasting connections. Green space can support local relationships through frequent informal meetings.\n\nThe most useful community projects combine ecological benefits with opportunities for conversation.\n\nAn accessible entrance and open meeting times could help more neighbors participate.",
  },
  {
    id: "SUB-004",
    title: "Shared spaces: a contextual reading",
    author: "Leo Morgan",
    kind: "submission",
    text:
      template +
      "\n\nThe fictional reading describes one possible mechanism: “" +
      common +
      "” (Rivera, 2025).\n\nThis observation should be considered alongside barriers to participation. Residents working evening shifts might find a weekend gardening session more accessible.\n\nReferences\nRivera, A. (2025). Gardens and everyday cooperation. Fictional Course Reader.",
  },
  {
    id: "SUB-005",
    title: "Designing for quiet participation",
    author: "Isla Reed",
    kind: "submission",
    text:
      template +
      "\n\nNot every resident wishes to join an organized activity. Shaded seating beside a pedestrian route can invite quiet observation without requiring conversation.\n\nMy design proposes wide pathways, raised planting beds, and signs with simple illustrations. These choices address physical access and varied communication preferences.\n\nEvaluation should ask who feels welcome and who remains absent. Counting visitors alone would overlook the quality of their experience.",
  },
  {
    id: "REF-001",
    title: "Gardens and everyday cooperation",
    author: "Dr. Alex Rivera (fictional)",
    kind: "reference",
    text:
      common +
      "\n\n" +
      water +
      "\n\nThis fictional teaching text illustrates connections between environmental stewardship and community participation. Local conditions shape whether shared projects are sustained over time.",
  },
  {
    id: "TPL-001",
    title: "Urban communities · assignment prompt",
    author: "Course team (fictional)",
    kind: "template",
    text: template,
  },
].map((d, i) => ({
  ...d,
  kind: d.kind as Document["kind"],
  createdAt: `2026-09-18T${String(9 + i).padStart(2, "0")}:30:00.000Z`,
}));
