function parseStructuredFields(body) {
  const out = {};
  const validKeys = new Set(['nombre', 'inicia', 'termina', 'hora', 'cuerpo', 'mensaje', 'frecuencia', 'grupo']);
  const fieldPattern = /^[\s*_~]*([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)[\s*_~]*\s*:\s*(.+)$/i;

  let currentKey = null;

  for (const line of body.split('\n')) {
    const trimmedLine = line.trim();
    
    // Stop parsing if we hit email signature or quoted thread dividers
    if (
      /^-{3,}\s*$/.test(trimmedLine) ||
      /^[Ee]l\s+.+ escribió:/i.test(trimmedLine) ||
      /^[Oo]n\s+.+ wrote:/i.test(trimmedLine) ||
      /^[-_=+]*\s*(Original Message|Mensaje Original)\s*[-_=+]*/i.test(trimmedLine) ||
      trimmedLine.startsWith('>') ||
      (trimmedLine.includes('bot.vectoritotsds@gmail.com') && Object.keys(out).length > 0)
    ) {
      break;
    }

    const match = trimmedLine.match(fieldPattern);
    if (match) {
      const key = match[1].toLowerCase();
      if (validKeys.has(key)) {
        currentKey = key;
        out[currentKey] = match[2].trim();
      } else {
        currentKey = null;
      }
    } else {
      if (currentKey === 'cuerpo' || currentKey === 'mensaje') {
        out[currentKey] = out[currentKey] ? `${out[currentKey]}\n${line}` : line;
      }
    }
  }

  for (const k of Object.keys(out)) {
    out[k] = out[k].trim();
  }

  return out;
}

const bodyText = `---------- Forwarded message ---------
From: Natalia Agustina MORAN <natalia.moran@example.com>
Date: Thu, Jun 11, 2026 at 8:21 AM
Subject: Inscripciones abiertas a los Coloquios de junio 2026
To: <bot.vectoritotsds@gmail.com>

Asunto: Inscripciones abiertas a los Coloquios de junio 2026 – SIU Guaraní
Cuerpo del mensaje:
nombre: Natalia Agustina MORAN
  inicia: 11/06/2026
  termina: [Fecha límite/fin, ej. DD/MM/AAAA] (Nota: El texto menciona como límite "hasta 48 hs hábiles previas al horario de la mesa", por lo que varía según cada examen)
hora: [Hora del evento, ej. 18:30]
  frecuencia: unica
grupo: 2024
cuerpo: ¡Buenas tardes!

Ya se encuentran abiertas las inscripciones por SIU Guaraní, a los Coloquios de junio 2026. Podrán inscribirse hasta 48 hs hábiles previas al horario de la mesa.

Tener en cuenta:

Instancia solo para la condición de promoción.

Ante inconvenientes con la inscripción, comunicarse a soporte.guarani@ispc.edu.ar

En los Módulos deben inscribirse a todos los espacios curriculares del módulo.

Inscribirse en la COMISIÓN que corresponda.

Recomendamos esperar a que cada docente finalice la carga de calificaciones y asistencia para ver la condición correspondiente (promoción/regular/libre). En el foro Avisos del curso Secretaría de Estudiantes podrán visualizar toda la información relacionada a la mesa.

A la hora de rendir deben ingresar al curso del Espacio Curricular/módulo y luego al mosaico “Coloquio”. Allí van a encontrar el link de meet.

Quedamos a disposición para lo que resulte necesario. Saludos.`;

console.log('Parsed Fields:', parseStructuredFields(bodyText));


