// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RepublicSurpriseContract {
    // ---------- Roles ----------
    address public owner;
    address public admin; // keep legacy "admin" variable for compatibility
    mapping(address => bool) public admins;
    mapping(address => bool) public deliveryMen;
    mapping(address => Role) public roles;

    enum Role {
        None,
        Buyer,
        Delivery,
        Admin,
        Seller
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender], "admin only");
        _;
    }

    modifier onlyDelivery() {
        require(deliveryMen[msg.sender], "delivery only");
        _;
    }

    modifier onlyDeliveryOrAdmin() {
        require(
            deliveryMen[msg.sender] || admins[msg.sender],
            "delivery/admin only"
        );
        _;
    }

    // ---------- Company ----------
    string public companyName;

    constructor() {
        companyName = "Republic Surprise Shop";
        owner = msg.sender;
        admin = address(0);
    }

    // --- Role management ---
    event AdminAdded(address indexed account);
    event DeliveryAdded(address indexed account);
    event RoleAssigned(
        address indexed account,
        Role role,
        address indexed actor
    );
    event RoleChanged(
        address indexed account,
        Role previousRole,
        Role newRole,
        address indexed actor
    );

    function addAdmin(address account) external onlyOwner {
        _setRole(account, Role.Admin);
        emit AdminAdded(account);
        emit RoleAssigned(account, Role.Admin, msg.sender);
    }

    function addDeliveryMan(address account) external onlyAdmin {
        _setRole(account, Role.Delivery);
        emit DeliveryAdded(account);
        emit RoleAssigned(account, Role.Delivery, msg.sender);
    }

    function isAdmin(address account) external view returns (bool) {
        return admins[account];
    }

    function isDelivery(address account) external view returns (bool) {
        return deliveryMen[account];
    }

    function assignRole(address account, Role role) external onlyAdmin {
        _setRole(account, role);
        emit RoleAssigned(account, role, msg.sender);
    }

    function changeRole(address account, Role role) external onlyAdmin {
        _setRole(account, role);
        emit RoleAssigned(account, role, msg.sender);
    }

    function _setRole(address account, Role role) internal {
        require(account != address(0), "bad account");
        Role previousRole = roles[account];

        if (role == Role.Admin) {
            admins[account] = true;
            deliveryMen[account] = false;
            if (admin == address(0)) {
                admin = account;
            }
        } else if (role == Role.Delivery) {
            deliveryMen[account] = true;
            admins[account] = false;
        } else {
            admins[account] = false;
            deliveryMen[account] = false;
        }

        roles[account] = role;
        emit RoleChanged(account, previousRole, role, msg.sender);
    }

    function _roleForRegistration(uint256 index) internal pure returns (Role) {
        if (index == 0) return Role.Admin;
        if (index == 1) return Role.Delivery;
        return Role.Buyer;
    }

    // ---------- Product ----------
    enum ProductStatus {
        Active,
        Inactive
    }

    struct Product {
        uint256 id;
        string name;
        string description;
        uint256 priceWei;
        uint256 stock;
        ProductStatus status;
    }

    uint256 public productCount;
    uint256 public RepublicSurpriseCount;

    mapping(uint256 => Product) public products;

    // ---------- Product Events ----------
    event ProductAdded(uint256 indexed id, string name, uint256 priceWei);
    event ProductStatusChanged(uint256 indexed id, ProductStatus status);

    function _validateProductConfig(
        uint256 priceWei,
        uint256 stock
    ) internal pure {
        require(priceWei > 0, "Price required");
        require(stock > 0, "Stock required");
    }

    function isInStock(uint256 id) public view returns (bool) {
        return products[id].stock > 0;
    }

    // Add product (auto-increment id)
    function addProduct(
        string calldata name,
        string calldata description,
        uint256 priceWei,
        uint256 stock
    ) public onlyAdmin {
        require(bytes(name).length > 0, "name required");

        _validateProductConfig(priceWei, stock);

        uint256 id = ++productCount;

        products[id] = Product({
            id: id,
            name: name,
            description: description,
            priceWei: priceWei,
            stock: stock,
            status: ProductStatus.Active
        });

        RepublicSurpriseCount = productCount;

        emit ProductAdded(id, name, priceWei);
    }

    function deactivateProduct(uint256 id) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        products[id].status = ProductStatus.Inactive;

        emit ProductStatusChanged(id, ProductStatus.Inactive);
    }

    function reactivateProduct(uint256 id) public onlyAdmin {
        require(products[id].id != 0, "Product not found");
        products[id].status = ProductStatus.Active;

        emit ProductStatusChanged(id, ProductStatus.Active);
    }

    // ---------- Users (on-chain status only) ----------
    struct UserProfile {
        uint256 id;
        bool exists;
        bytes32 profileHash;
    }

    mapping(address => UserProfile) public users;
    uint256 public userCount;

    event UserRegistered(address indexed user, bytes32 profileHash);
    event UserProfileUpdated(address indexed user, bytes32 profileHash);

    function registerUser(address user, bytes32 profileHash) public {
        require(!users[user].exists, "User exists");
        Role assignedRole = _roleForRegistration(userCount);
        uint256 id = ++userCount;
        users[user] = UserProfile(id, true, profileHash);
        _setRole(user, assignedRole);
        emit RoleAssigned(user, assignedRole, msg.sender);
        emit UserRegistered(user, profileHash);
    }

    // ---------- Orders / Delivery (Merged main flow) ----------
    enum OrderStatus {
        Pending,
        Paid,
        OutForDelivery,
        PendingConfirmation,
        Completed,
        Cancelled
    }

    struct Order {
        uint256 id;
        address buyer;
        uint256 productId;
        uint256 qty;
        uint256 paid; // wei
        OrderStatus status;
        string deliveryId;
        string proofImage; // base64 hash/URI if needed
    }

    uint256 public orderCount;
    mapping(uint256 => Order) public orders;
    mapping(uint256 => address) public orderDeliveryMan;
    mapping(address => uint256[]) private ordersByDeliveryMan;

    struct DeliveryLog {
        OrderStatus status;
        string note;
        string proofImage;
        uint256 timestamp;
        address actor;
    }

    mapping(uint256 => DeliveryLog[]) private deliveryLogs;

    event OrderCreated(
        uint256 indexed orderId,
        uint256 productId,
        address buyer,
        uint256 qty,
        uint256 paid
    );

    event DeliveryStatus(
        uint256 indexed orderId,
        string deliveryId,
        OrderStatus status,
        string proofImage
    );

    event OrderStatusChanged(uint256 indexed orderId, OrderStatus status);
    event DeliveryAssigned(
        uint256 indexed orderId,
        address indexed deliveryMan,
        address indexed actor
    );
    event DeliveryLogAdded(
        uint256 indexed orderId,
        OrderStatus status,
        address indexed actor,
        string note,
        string proofImage
    );

    function _logDelivery(
        uint256 orderId,
        OrderStatus status,
        string memory note,
        string memory proofImage
    ) internal {
        deliveryLogs[orderId].push(
            DeliveryLog({
                status: status,
                note: note,
                proofImage: proofImage,
                timestamp: block.timestamp,
                actor: msg.sender
            })
        );
        emit DeliveryLogAdded(orderId, status, msg.sender, note, proofImage);
    }

    function productPrice(
        uint256 productId,
        uint256 qty
    ) external view returns (uint256) {
        Product memory p = products[productId];
        uint256 unit = p.priceWei;
        require(unit > 0, "price missing");
        return unit * qty;
    }

    function buy(
        uint256 productId,
        uint256 qty,
        string calldata deliveryId
    ) external payable returns (uint256 orderId) {
        require(qty > 0, "qty > 0");

        Product storage p = products[productId];
        require(p.id != 0, "product not found");
        require(p.status == ProductStatus.Active, "inactive product");
        require(p.priceWei > 0, "mode disabled");
        require(p.stock > 0, "Out of stock");
        require(p.stock >= qty, "insufficient stock");

        uint256 unit = p.priceWei;
        require(unit > 0, "price missing");
        uint256 totalPrice = unit * qty;

        require(msg.value == totalPrice, "wrong payment");

        // debit stock
        p.stock -= qty;

        orderId = ++orderCount;
        orders[orderId] = Order({
            id: orderId,
            buyer: msg.sender,
            productId: productId,
            qty: qty,
            paid: msg.value,
            status: OrderStatus.Paid,
            deliveryId: deliveryId,
            proofImage: ""
        });

        emit OrderCreated(orderId, productId, msg.sender, qty, msg.value);
        _logDelivery(orderId, OrderStatus.Paid, "ORDER_PAID", "");
    }

    function markOutForDelivery(
        uint256 orderId,
        string calldata deliveryId
    ) external onlyAdmin {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");
        require(o.status == OrderStatus.Paid, "not paid");

        o.status = OrderStatus.OutForDelivery;
        o.deliveryId = deliveryId;

        emit DeliveryStatus(orderId, deliveryId, o.status, "");
        _logDelivery(orderId, o.status, "OUT_FOR_DELIVERY", "");
    }

    // merged signature: allow delivery man OR admin (since old code used onlyAdmin)
    function submitProof(
        uint256 orderId,
        string calldata proofImage
    ) external onlyDeliveryOrAdmin {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");
        require(o.status == OrderStatus.OutForDelivery, "wrong state");

        o.proofImage = proofImage;
        o.status = OrderStatus.PendingConfirmation;

        emit DeliveryStatus(orderId, o.deliveryId, o.status, proofImage);
        _logDelivery(orderId, o.status, "PROOF_SUBMITTED", proofImage);
    }

    function confirmDelivery(uint256 orderId) external onlyAdmin {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");
        require(o.status == OrderStatus.PendingConfirmation, "wrong state");

        o.status = OrderStatus.Completed;
        emit OrderStatusChanged(orderId, o.status);
        _logDelivery(orderId, o.status, "DELIVERY_CONFIRMED", o.proofImage);
    }

    function assignDeliveryManToOrder(
        uint256 orderId,
        address deliveryMan
    ) external onlyAdmin {
        require(deliveryMen[deliveryMan], "not delivery");
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");

        orderDeliveryMan[orderId] = deliveryMan;
        ordersByDeliveryMan[deliveryMan].push(orderId);
        emit DeliveryAssigned(orderId, deliveryMan, msg.sender);
    }

    function deliveryAddStatus(
        uint256 orderId,
        OrderStatus status,
        string calldata note,
        string calldata proofImage
    ) external onlyDeliveryOrAdmin {
        _setDeliveryStatus(orderId, status, note, proofImage);
    }

    function deliveryUpdateStatus(
        uint256 orderId,
        OrderStatus status,
        string calldata note,
        string calldata proofImage
    ) external onlyDeliveryOrAdmin {
        _setDeliveryStatus(orderId, status, note, proofImage);
    }

    function _setDeliveryStatus(
        uint256 orderId,
        OrderStatus status,
        string calldata note,
        string calldata proofImage
    ) internal {
        Order storage o = orders[orderId];
        require(o.id != 0, "order not found");

        if (!admins[msg.sender]) {
            require(
                status == OrderStatus.OutForDelivery ||
                    status == OrderStatus.PendingConfirmation,
                "admin only status"
            );
        }

        o.status = status;
        if (bytes(proofImage).length > 0) {
            o.proofImage = proofImage;
        }

        emit OrderStatusChanged(orderId, status);
        _logDelivery(orderId, status, note, proofImage);
    }

    function getDeliveryHistory(
        uint256 orderId
    ) external view returns (DeliveryLog[] memory) {
        return deliveryLogs[orderId];
    }

    function getOrderDetail(
        uint256 orderId
    ) external view returns (Order memory) {
        return orders[orderId];
    }

    function getOrdersForDelivery(
        address deliveryMan
    ) external view returns (uint256[] memory) {
        return ordersByDeliveryMan[deliveryMan];
    }

    // ---------- User Order Tracking (legacy) ---------- (angela)
    enum UserOrderStatus {
        Placed,
        Paid,
        Shipped,
        Delivered,
        Completed,
        Cancelled
    }

    struct UserOrder {
        uint256 id;
        address buyer;
        uint256 totalAmount;
        UserOrderStatus status;
        uint256 createdAt;
    }

    mapping(uint256 => UserOrder) public userOrders;
    mapping(address => uint256[]) public userOrdersByUser;
    uint256 public nextUserOrderId;

    event UserOrderCreated(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 totalAmount
    );
    event UserOrderStatusUpdated(
        uint256 indexed orderId,
        UserOrderStatus status
    );

    function createUserOrder(uint256 totalAmount) external {
        uint256 id = nextUserOrderId;
        nextUserOrderId += 1;

        userOrders[id] = UserOrder({
            id: id,
            buyer: msg.sender,
            totalAmount: totalAmount,
            status: UserOrderStatus.Placed,
            createdAt: block.timestamp
        });

        userOrdersByUser[msg.sender].push(id);
        emit UserOrderCreated(id, msg.sender, totalAmount);
    }

    function updateUserOrderStatus(
        uint256 id,
        UserOrderStatus status
    ) external onlyAdmin {
        UserOrder storage o = userOrders[id];
        require(o.buyer != address(0), "order not found");
        o.status = status;
        emit UserOrderStatusUpdated(id, status);
    }

    // ---------- Legacy Payment (kept) ----------
    struct Payment {
        address buyer;
        uint256 amountPaid; // wei
    }

    mapping(uint256 => Payment) public payments; // orderId -> payment

    event Paid(uint256 orderId, address buyer, uint256 amountPaid);
    function paywithMetamask(
        uint256 orderId,
        uint256 productId
    ) public payable {
        require(msg.value > 0, "pay > 0");
        require(orders[orderId].id == 0, "order exists");
        require(products[productId].id != 0, "product not found");

        Product storage p = products[productId];
        require(p.status == ProductStatus.Active, "inactive product");
        require(p.stock > 0, "Out of stock");
        require(p.stock >= 1, "insufficient stock");

        require(p.priceWei > 0, "price missing");
        require(msg.value == p.priceWei, "incorrect amount");

        // debit 1 box
        p.stock -= 1;

        // store legacy payment record
        payments[orderId] = Payment(msg.sender, msg.value);

        // create merged order
        orders[orderId] = Order({
            id: orderId,
            buyer: msg.sender,
            productId: productId,
            qty: 1,
            paid: msg.value,
            status: OrderStatus.Paid,
            deliveryId: "",
            proofImage: ""
        });

        // keep orderCount consistent (optional)
        if (orderId > orderCount) orderCount = orderId;

        emit Paid(orderId, msg.sender, msg.value);
        emit OrderCreated(orderId, productId, msg.sender, 1, msg.value);
    }

    // ---------- Treasury ----------
    function withdraw(address payable to, uint256 amount) external onlyAdmin {
        require(amount <= address(this).balance, "exceeds balance");
        to.transfer(amount);
    }

    // ---------- Safety ----------
    receive() external payable {}
}
