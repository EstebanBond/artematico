// Documentos GraphQL usados por las pantallas. El SDL fuente de verdad vive en
// apps/bff/src/schema.graphql — no inventar campos que no estén ahí.

export const TODAY_QUERY = /* GraphQL */ `
  query Today {
    today {
      lesson {
        id
        week
        dayIndex
        technique
        tema
        papel
        consigna
        criteriosFoco
        materialesExtra
        videoUrl
      }
      recentSubmissions {
        id
        status
        objectKey
        sessionNumber
        createdAt
      }
    }
  }
`;

export const SUBMISSION_QUERY = /* GraphQL */ `
  query SubmissionStatus($id: ID!) {
    submission(id: $id) {
      id
      status
      objectKey
      sessionNumber
      createdAt
      evaluation {
        loQueFunciona
        loQueSigue
        microEjercicio {
          instruccion
          minutos
        }
      }
    }
  }
`;

export const SUBMIT_FOR_EVALUATION_MUTATION = /* GraphQL */ `
  mutation SubmitForEvaluation($submissionId: ID!, $ratings: [CriterioRatingInput!]!) {
    submitForEvaluation(submissionId: $submissionId, ratings: $ratings) {
      id
      status
    }
  }
`;

export const PARENT_PANEL_QUERY = /* GraphQL */ `
  query ParentPanelData {
    parentPanel {
      estudiantes { id name }
      paquetes { studentId studentName disponible }
      banderas { submissionId studentId studentName sessionNumber lessonTema texto createdAt }
      materiales { id item critical week purchaseByDate semaforo notas comprada }
    }
  }
`;

export const MARCAR_MATERIAL_MUTATION = /* GraphQL */ `
  mutation MarcarMaterial($id: ID!, $comprada: Boolean!) {
    marcarMaterial(id: $id, comprada: $comprada) {
      id
      comprada
    }
  }
`;
