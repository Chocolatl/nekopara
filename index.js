"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const EventEmitter = require("events");
const Qnext = require("qnext");
var NodeType;
(function (NodeType) {
    NodeType[NodeType["data"] = 0] = "data";
    NodeType[NodeType["task"] = 1] = "task";
})(NodeType || (NodeType = {}));
var TaskState;
(function (TaskState) {
    TaskState[TaskState["waiting"] = 0] = "waiting";
    TaskState[TaskState["done"] = 1] = "done";
    TaskState[TaskState["fail"] = 2] = "fail"; // 任务节点执行出错，子节点为空
})(TaskState || (TaskState = {}));
function createTaskNode(template, url) {
    return {
        type: NodeType.task,
        state: TaskState.waiting,
        template: template,
        url: url,
        children: []
    };
}
function createDataNode(data) {
    return {
        type: NodeType.data,
        data: data
    };
}
/**
 * 前序遍历给定的树，子节点遍历方向为从左到右
 */
function preOrderTraversal(root, cb) {
    const stack = [];
    const handle = (node) => {
        cb(node);
        if (node.type === NodeType.task) {
            stack.push({
                cur: -1,
                len: node.children.length,
                node: node
            });
        }
    };
    handle(root);
    while (stack.length) {
        const top = stack[stack.length - 1];
        // 该节点已遍历完成
        if (top.cur === top.len - 1) {
            stack.pop();
            continue;
        }
        const children = top.node.children;
        const child = children[++top.cur];
        handle(child);
    }
}
class Nekopara extends EventEmitter {
    constructor(opts = {}) {
        super();
        const defaultOpts = {
            thread: 1,
            interval: 0,
            distinct: true
        };
        this.options = Object.assign({}, defaultOpts, opts);
        const thread = this.options.thread;
        this.crawlTree = null; // 爬行进度树
        this.urlSet = Object.create(null); // 已爬行URL集合
        this.taskQueue = new Qnext(thread); // 爬行任务队列
        this.templates = Object.create(null); // 爬行模板映射
        this.delayQueue = new Qnext(1); // 执行间隔控制队列
        this.stopped = false; // 停止爬行指示器，会在调用this.stop后被设为true
    }
    /**
     * 调用该函数创建一个Pormise实例，创建多个Promise实例时，它们会至少间隔opts.interval毫秒变为fulfilled
     */
    createDelayPromise() {
        return new Promise(resolve => {
            this.delayQueue.add(() => __awaiter(this, void 0, void 0, function* () {
                resolve(); // 轮到该任务时立即resolve
            }));
            this.delayQueue.add(() => new Promise(resolve => setTimeout(resolve, this.options.interval))); // 向队列中添加一个opts.interval毫秒后完成的任务
        });
    }
    addTask(node, template, url) {
        const task = () => __awaiter(this, void 0, void 0, function* () {
            try {
                if (this.stopped) {
                    return; // this.stop已被调用，放弃队列中的任务
                }
                const templateFunc = this.templates[template];
                if (!templateFunc) {
                    throw new Error(`Templete '${template}' does not exist`);
                }
                yield this.createDelayPromise();
                const { add, exec } = this.createAddFunc(node);
                // 将url和add注入templateFunc中，注入的add只能在templateFunc()变为完成态之前被调用，
                // 因为通过add添加的任务将在templateFunc变为resolved的时候被一次性执行
                yield templateFunc(url, add);
                // 执行所有templateFunc中使用add添加的任务
                exec();
                node.state = TaskState.done;
            }
            catch (err) {
                node.state = TaskState.fail; // 标记为错误        
                this.emit('fail', err);
            }
        });
        this.taskQueue.add(task);
    }
    createAddFunc(taskNode) {
        const executeQueue = [];
        // 添加子节点函数，该函数并不真正添加节点，而是将任务放入队列中
        // 传入一个参数时表示添加的是数据节点，参数1为节点数据
        // 传入二个参数时表示添加的是任务节点，参数1为模板名称，参数2为爬行URL
        const add = (...args) => {
            executeQueue.push(args);
        };
        // 执行函数，依次执行队列中的添加节点任务
        // exec执行前taskNode.children为空，执行后taskNode.children拥有最终的节点数
        // taskNode.children不存在只收集了部分的情况，所以this.crawlTree可以随时保存快照
        const exec = () => {
            for (const i of executeQueue) {
                if (i.length === 1) {
                    const data = i[0];
                    const node = createDataNode(data);
                    taskNode.children.push(node); // 添加数据节点
                    // 异步触发事件，否则不能保证exec是一个完整的过程
                    // 如果同步触发，用户在onData的逻辑中保存快照，parentNode.children就会处于只收集了部分节点的情况
                    setTimeout(() => this.emit('data', data));
                    continue;
                }
                const [template, url] = i;
                // 去重
                if (this.options.distinct && this.urlSet[url]) {
                    continue;
                }
                this.urlSet[url] = true;
                // 创建任务节点
                const node = createTaskNode(template, url);
                if (taskNode === null) {
                    this.crawlTree = node; // 初始化根节点
                }
                else {
                    taskNode.children.push(node);
                }
                this.addTask(node, template, url);
            }
        };
        return { add, exec };
    }
    /**
     * 注册爬行模板
     * @param template 模板名称
     * @param func 模板函数
     */
    register(template, func) {
        if (this.templates[template]) {
            throw new Error(`Template '${template}' has been registered`);
        }
        this.templates[template] = func;
    }
    /**
     * 获取爬行结果
     * @returns 包含`list`和`complete`字段的对象，`list`为当前已爬行的数据集合，`complete`在爬行未完成或存在错误节点时值为`false`
     */
    getResults() {
        const list = [];
        let complete = true;
        preOrderTraversal(this.crawlTree, (node) => {
            if (node.type === NodeType.task) {
                if (node.state !== TaskState.done) {
                    complete = false;
                }
            }
            if (node.type === NodeType.data) {
                list.push(node.data);
            }
        });
        return { list, complete };
    }
    /**
     * 返回当前爬行进度的快照
     */
    snapshot() {
        return JSON.parse(JSON.stringify(this.crawlTree));
    }
    /**
     * 终止爬行，任务列表中等待执行的任务将不会被执行
     * 调用该函数后将不会触发done事件
     */
    stop() {
        this.stopped = true;
    }
    onDone() {
        if (this.stopped)
            return;
        // 异步触发done事件，防止用户在nekopara.start之后监听该事件
        // 导致在nekopara.start中传入一个已完成的任务快照，同步调用onDone导致用户没有收到事件
        setTimeout(() => this.emit('done'));
    }
    start(...args) {
        if (args.length === 1) {
            const [snapshot] = args;
            this.startWithSnapshot(snapshot);
        }
        if (args.length === 2) {
            const [template, url] = args;
            this.startWithEntry(template, url);
        }
        this.taskQueue.on('empty', () => {
            this.onDone();
        });
        this.start = () => {
            throw new Error('Cannot call start again');
        };
    }
    startWithEntry(template, url) {
        const { add, exec } = this.createAddFunc(null);
        add(template, url);
        exec();
    }
    startWithSnapshot(snapshot) {
        let completely = true;
        this.crawlTree = JSON.parse(JSON.stringify(snapshot));
        preOrderTraversal(this.crawlTree, (node) => {
            const isTaskNode = (node) => node.type === NodeType.task;
            const state = TaskState;
            // 重建已爬行URL集合
            if (isTaskNode(node)) {
                this.urlSet[node.url] = true;
            }
            // 任务状态为waiting或fail
            if (isTaskNode(node) && node.state !== state.done) {
                completely = false;
                node.state = state.waiting;
                this.addTask(node, node.template, node.url);
            }
        });
        // 没有未完成的任务
        if (completely) {
            this.onDone();
        }
    }
}
module.exports = Nekopara;
