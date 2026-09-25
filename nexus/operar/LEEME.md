# Poner GPS Nexus en marcha

Dos procesos, no uno:

| Proceso | Qué hace | Si no corre |
|---|---|---|
| El servidor web | Atiende el portal | Nadie entra. **Se nota el primer minuto.** |
| `herramientas/avisar.ts` | Vacía la cola de avisos | Todo sigue funcionando y **nadie se entera de nada**. No se nota hasta que alguien se queja de que no le llegó un correo, semanas después. |

El segundo es el que se olvida, y por eso va aquí con su unidad de systemd hecha:
[`nexus-avisos.service`](nexus-avisos.service). Se copia, se enciende y se olvida.

Se prefiere systemd a una línea de cron por un motivo concreto: **una línea de cron mal
escrita no da error**, simplemente no hace nada, y eso no se descubre hasta que hace
falta. `systemctl status nexus-avisos` contesta en un segundo si está vivo o no.

## Comprobar que los avisos están saliendo

```bash
systemctl status nexus-avisos           # tiene que decir «active (running)»
journalctl -u nexus-avisos --since today
```

Si en el registro no aparece nada, **es lo correcto**: solo escribe cuando manda algo
o cuando falla. Un registro lleno de líneas que dicen «cero enviados» es un registro
que nadie lee, y entonces tampoco se lee la línea del día que sí falló.

Para ver la cola por dentro, desde la base de datos:

```sql
select estado, count(*) from aviso group by estado;
select * from aviso where estado = 'fallido' order by creado_en desc limit 20;
```

Un aviso fallido guarda por qué falló. Lo que **no** guarda es el correo dentro del
registro del sistema: un registro se comparte y un correo es un dato personal.

## Se puede arrancar sin tener el correo listo

Sin `NEXUS_SMTP` configurado, escribe en el registro lo que habría mandado en vez de
mandarlo. Sirve para el primer día. Un sistema que no arranca sin el correo
configurado es un sistema que no arranca.
