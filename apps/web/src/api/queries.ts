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
      banderas { submissionId sessionNumber lessonTema texto createdAt }
      comprasPendientes { id item critical purchaseByDate semaforo notas }
    }
  }
`;
