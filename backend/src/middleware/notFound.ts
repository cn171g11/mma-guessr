import type { RequestHandler } from 'express';

export const notFound: RequestHandler = (_req, res) => {
    // 不回显请求 URL，避免把客户端输入或内部路径信息反射回浏览器
    res.status(404).json({
        error: 'Not Found',
    });
};
