# Guion de demostración (aprox. 1:20)

## 0:00-0:10 — Arquitectura

Mostrar el diagrama y explicar: “La carga en `originals/` genera un evento de S3 que invoca automáticamente una Lambda TypeScript. El resultado se escribe en `resized/` y la ejecución queda registrada en CloudWatch”.

## 0:10-0:25 — Configuración

Mostrar la Lambda y sus variables `OUTPUT_WIDTH=800`, `OUTPUT_HEIGHT=600`, `INPUT_PREFIX=originals/` y `OUTPUT_PREFIX=resized/`. Mostrar también el trigger `s3:ObjectCreated:*` con el filtro de prefijo.

## 0:25-0:40 — Carga original

En S3, entrar a `originals/`, cargar `paisaje-demo-original.jpg` y mostrar que sus dimensiones son 1600 × 1200. Aclarar que la imagen original no se sobrescribe.

## 0:40-0:55 — Resultado automático

Actualizar el bucket, abrir `resized/` y mostrar `paisaje-demo-original-800x600.jpg`. Recalcar que no se cargó manualmente.

## 0:55-1:10 — Dimensiones y logs

Mostrar las propiedades o metadatos `width=800`, `height=600`, después abrir CloudWatch y enseñar el registro `status: success`, con dimensiones originales 1600 × 1200 y resultado 800 × 600.

## 1:10-1:20 — Cierre

Mostrar juntos los dos objetos y concluir: “El flujo conserva el original, produce una salida relacionada e idempotente y evita ciclos porque el trigger solo observa `originals/`”.

