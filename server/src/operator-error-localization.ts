import type { RequestHandler } from "express";
import type { UiLanguage } from "@paperclipai/shared";
import { getRequestUiLanguage } from "./ui-language.js";

const EXACT_ERROR_TRANSLATIONS: Record<string, string> = {
  Unauthorized: "Требуется авторизация",
  Forbidden: "Доступ запрещен",
  "Not found": "Не найдено",
  "Validation error": "Ошибка валидации",
  "Internal server error": "Внутренняя ошибка сервера",
  "API route not found": "API-маршрут не найден",
  "Board access required": "Требуется доступ board",
  "Agent authentication required": "Требуется аутентификация агента",
  "Permission denied": "Недостаточно прав",
  "Instance admin access required": "Требуется доступ администратора инстанса",
  "Instance admin required": "Требуются права администратора инстанса",
  "User does not have access to this company": "У пользователя нет доступа к этой компании",
  "Agent key cannot access another company": "Ключ агента не может получать доступ к другой компании",
  "Board mutation requires trusted browser origin": "Изменения board разрешены только из доверенного источника браузера",
  "Request body is required": "Тело запроса обязательно",
  "Company not found": "Компания не найдена",
  "Agent not found": "Агент не найден",
  "Issue not found": "Задача не найдена",
  "Project not found": "Проект не найден",
  "Goal not found": "Цель не найдена",
  "Approval not found": "Аппрув не найден",
  "Routine not found": "Рутина не найдена",
  "Routine trigger not found": "Триггер рутины не найден",
  "Workspace operation not found": "Операция workspace не найдена",
  "Workspace operation log not found": "Лог операции workspace не найден",
  "Run log not found": "Лог запуска не найден",
  "Heartbeat run not found": "Запуск heartbeat не найден",
  "Secret not found": "Секрет не найден",
  "Secret version not found": "Версия секрета не найдена",
  "Plugin not found": "Плагин не найден",
  "Plugin config not found": "Конфигурация плагина не найдена",
  "Skill not found": "Скилл не найден",
  "Invite not found": "Инвайт не найден",
  "Join request not found": "Запрос на вступление не найден",
  "Member not found": "Участник не найден",
  "Key not found": "Ключ не найден",
  "Asset not found": "Ассет не найден",
  "Object not found": "Объект не найден",
  "File not found": "Файл не найден",
  "Access denied": "Доступ запрещен",
  "File path is required": "Путь к файлу обязателен",
  "Invalid file path": "Недопустимый путь к файлу",
  "Invalid object key": "Недопустимый ключ объекта",
  "Invalid object key path": "Недопустимый путь ключа объекта",
  "Missing file field 'file'": "Обязательное поле файла 'file' отсутствует",
  "Invalid image metadata": "Недопустимые метаданные изображения",
  "SVG could not be sanitized": "Не удалось безопасно обработать SVG",
  "Image is empty": "Изображение пустое",
  "Plugin tool dispatch is not enabled": "Вызов инструментов плагинов не включен",
  "Plugin settings UI is unavailable right now": "Интерфейс настроек плагина сейчас недоступен",
  "Configuration does not match the plugin's instanceConfigSchema": "Конфигурация не соответствует instanceConfigSchema плагина",
  "Query parameter 'path' is required": "Обязателен query-параметр 'path'",
  "Use /api/agents/:id/permissions for permission changes": "Используйте /api/agents/:id/permissions для изменения прав",
  "adapterConfig must be an object": "adapterConfig должен быть объектом",
  "Login is only supported for claude_local agents": "Логин поддерживается только для агентов claude_local",
  "Invalid claim secret": "Недопустимый секрет подтверждения",
  "Claim code is required": "Требуется код подтверждения",
};

const PATTERN_TRANSLATIONS: Array<{
  pattern: RegExp;
  translate: (...matches: string[]) => string;
}> = [
  {
    pattern: /^Tool "(.+)" not found$/,
    translate: (tool) => `Инструмент "${tool}" не найден`,
  },
  {
    pattern: /^Unknown adapter type: (.+)$/,
    translate: (type) => `Неизвестный тип адаптера: ${type}`,
  },
  {
    pattern: /^Invalid status '(.+)'\. Must be one of: (.+)$/,
    translate: (status, values) => `Недопустимый статус "${status}". Допустимые значения: ${values}`,
  },
  {
    pattern: /^File exceeds (\d+) bytes$/,
    translate: (size) => `Файл превышает допустимый размер ${size} байт`,
  },
  {
    pattern: /^Image exceeds (\d+) bytes$/,
    translate: (size) => `Изображение превышает допустимый размер ${size} байт`,
  },
  {
    pattern: /^Unsupported file type: (.+)$/,
    translate: (type) => `Неподдерживаемый тип файла: ${type}`,
  },
  {
    pattern: /^Unsupported image type: (.+)$/,
    translate: (type) => `Неподдерживаемый тип изображения: ${type}`,
  },
];

export function localizeOperatorErrorMessage(message: string, locale: UiLanguage): string {
  if (locale !== "ru") return message;

  const exact = EXACT_ERROR_TRANSLATIONS[message];
  if (exact) return exact;

  for (const { pattern, translate } of PATTERN_TRANSLATIONS) {
    const match = pattern.exec(message);
    if (match) return translate(...match.slice(1));
  }

  return message;
}

function shouldLocalizeOperatorResponse(reqActorType: "board" | "agent" | "none"): boolean {
  return reqActorType !== "agent";
}

export function operatorErrorLocalizationMiddleware(): RequestHandler {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      if (
        shouldLocalizeOperatorResponse(req.actor.type)
        && body
        && typeof body === "object"
        && !Array.isArray(body)
      ) {
        const locale = getRequestUiLanguage(req);
        const payload = body as Record<string, unknown>;
        let changed = false;
        const nextPayload: Record<string, unknown> = { ...payload };

        if (typeof payload.error === "string") {
          nextPayload.error = localizeOperatorErrorMessage(payload.error, locale);
          changed = changed || nextPayload.error !== payload.error;
        }

        if (
          typeof payload.message === "string"
          && (typeof payload.code === "string" || typeof payload.error === "string")
        ) {
          nextPayload.message = localizeOperatorErrorMessage(payload.message, locale);
          changed = changed || nextPayload.message !== payload.message;
        }

        return originalJson(changed ? nextPayload : body);
      }

      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}
